"""Tests for the source-faithful research package."""

from __future__ import annotations

import pandas as pd

from pipeline.research_data import (
    build_entity_dimension,
    build_indicator_dimension,
    build_research_observations,
    build_research_package,
)


def _master() -> pd.DataFrame:
    rows = [
        ("KEN", "Kenya", 2023, "GHED_che_gdp", "CHE (% GDP)", 4.2, "WHO GHED"),
        ("KEN", "Kenya", 2023, "GHED_CHEGDP_SHA2011", "CHE (% GDP)", 4.2, "WHO GHO"),
        ("KEN", "Kenya", 2023, "SH.DYN.MORT", "Under-5 mortality", 40.0, "World Bank"),
        ("KEN", "Kenya", 2023, "UNAIDS_FIN_TOTAL", "Total HIV financing (USD)", 3.0, "UNAIDS"),
        ("WLD", "World", 2023, "SH.DYN.MORT", "Under-5 mortality", 37.0, "World Bank"),
        ("KOS", "Kosovo", 2025, "WB_FCV_STATUS", "FCV", 1.0, "World Bank FCV"),
    ]
    return pd.DataFrame(
        [
            {
                "iso3": iso3,
                "country_name": country,
                "year": year,
                "indicator_code": code,
                "indicator_name": name,
                "value": value,
                "source": source,
                "pulled_at": "2026-01-01 UTC",
            }
            for iso3, country, year, code, name, value, source in rows
        ]
    )


def _metadata() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"iso3": "KEN", "country_name": "Kenya", "is_fcs": False},
            {"iso3": "XKX", "country_name": "Kosovo", "is_fcs": True},
        ]
    )


def test_domains_and_legacy_aliases(tmp_path):
    indicators = build_indicator_dimension(_master(), workbook=tmp_path / "missing.xlsx")
    by_code = indicators.set_index("indicator_code")
    assert by_code.loc["GHED_che_gdp", "research_domain"] == "health_financing"
    assert by_code.loc["SH.DYN.MORT", "research_domain"] == "health_program"
    assert by_code.loc["UNAIDS_FIN_TOTAL", "research_domain"] == "health_financing"
    assert by_code.loc["GHED_CHEGDP_SHA2011", "series_role"] == "legacy_mirror"
    assert by_code.loc["GHED_CHEGDP_SHA2011", "canonical_indicator_code"] == "GHED_che_gdp"
    assert not bool(by_code.loc["GHED_CHEGDP_SHA2011", "include_in_default"])


def test_entities_distinguish_aggregates_and_normalize_kosovo():
    entities = build_entity_dimension(_master(), _metadata()).set_index("entity_id")
    assert "XKX" in entities.index
    assert entities.loc["WLD", "entity_type"] == "aggregate"
    assert not bool(entities.loc["WLD", "is_country_or_territory"])
    assert bool(entities.loc["XKX", "fcv_current"])
    assert entities.loc["XKX", "fcv_vintage"] == "FY2026"


def test_observations_keep_source_codes_and_attach_research_keys(tmp_path):
    master = _master()
    indicators = build_indicator_dimension(master, workbook=tmp_path / "missing.xlsx")
    entities = build_entity_dimension(master, _metadata())
    observations = build_research_observations(master, indicators, entities)
    kosovo = observations[observations["source_entity_code"].eq("KOS")].iloc[0]
    assert kosovo["entity_id"] == "XKX"
    assert kosovo["research_domain"] == "country_context"
    assert observations["series_id"].notna().all()


def test_package_preserves_audit_rows_but_filters_domain_files(tmp_path):
    master_path = tmp_path / "master.parquet"
    metadata_path = tmp_path / "country_metadata.parquet"
    out_dir = tmp_path / "research"
    _master().to_parquet(master_path, index=False)
    _metadata().to_parquet(metadata_path, index=False)

    report = build_research_package(
        master_path=master_path,
        metadata_path=metadata_path,
        out_dir=out_dir,
        ghed_workbook=tmp_path / "missing.xlsx",
    )

    all_rows = pd.read_parquet(out_dir / "observations_all_sources.parquet")
    finance = pd.read_parquet(out_dir / "health_financing.parquet")
    programs = pd.read_parquet(out_dir / "health_programs.parquet")
    assert len(all_rows) == 6
    assert not finance["series_role"].eq("legacy_mirror").any()
    assert not programs["entity_type"].eq("aggregate").any()
    assert report["unclassified_indicator_series"] == 0
    assert (out_dir / "CATALOG.md").exists()
