"""Build source-faithful, research-oriented data products.

The dashboard master table is intentionally compact.  This module creates a
separate package for exploratory research in Positron without changing raw
files or imposing a study-specific sample, transformation, or missing-data
strategy.

Outputs are written to ``data/research``:

* observations_all_sources.parquet -- all master observations with research
  domains, stable entity IDs, canonical-code links, and quality flags.
* health_financing.parquet -- country/territory financing observations,
  excluding sparse legacy WHO-GHO mirrors.
* health_programs.parquet -- country/territory program and outcome data.
* country_context.parquet -- macroeconomic and governance observations.
* public_financial_management.parquet -- PEFA/PFM observations.
* dim_entities.parquet -- entity type, geography, and versioned current FCV.
* dim_indicators.parquet/csv -- one row per source series with coverage and
  semantic metadata.
* indicator_aliases.parquet -- explicit legacy-to-canonical GHED mappings.
* ghed_series_metadata.parquet -- country-series notes from the GHED workbook.
* inventory_by_domain_source.csv and validation_report.json -- audit aids.

The narrower domain files exclude aggregates to make accidental mixing less
likely.  Nothing is deleted: aggregates, historical entities, and legacy
series remain in ``observations_all_sources.parquet`` with explicit flags.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import pandas as pd
import pycountry

from .config import DATA_DIR, MANUAL_DIR, PROCESSED_DIR
from .indicator_registry import REGISTRY
from .wgi import FCV_CURRENT_ISO3, FCV_REFERENCE_YEAR, FCV_VINTAGE

logger = logging.getLogger(__name__)

RESEARCH_DIR = Path(DATA_DIR) / "research"
GHED_WORKBOOK = Path(MANUAL_DIR) / "GHED_data.xlsx"

# Source codes that refer to the same entity.  The original code is retained in
# observations as source_entity_code; entity_id is the stable join key.
ENTITY_ALIASES: dict[str, str] = {
    "KOS": "XKX",  # World Bank FCV spelling
    "KSV": "XKX",  # occasional World Bank spelling
    "UVK": "XKX",  # IMF spelling
    "WBG": "PSE",  # IMF West Bank and Gaza spelling
}

# WHO GHO republishes a small, sparse subset of GHED.  Map those series to the
# fuller December-2025 workbook codes, but retain the original observations in
# the all-sources file for audit and revision comparisons.
LEGACY_GHED_ALIASES: dict[str, str] = {
    "GHED_CHE_pc_US_SHA2011": "GHED_che_pc_usd",
    "GHED_CHEGDP_SHA2011": "GHED_che_gdp",
    "GHED_GGHE-D_pc_US_SHA2011": "GHED_gghed_pc_usd",
    "GHED_GGHE-DGDP_SHA2011": "GHED_gghed_gdp",
    "GHED_GGHE-DCHE_SHA2011": "GHED_gghed_che",
    "GHED_GGHE-DGGE_SHA2011": "GHED_gghed_gge",
    "GHED_OOP_pc_US_SHA2011": "GHED_oop_pc_usd",
    "GHED_OOPSCHE_SHA2011": "GHED_oops_che",
    "GHED_EXT_pc_US_SHA2011": "GHED_ext_pc_usd",
    "GHED_EXTCHE_SHA2011": "GHED_ext_che",
    "GHED_PVT-D_pc_US_SHA2011": "GHED_pvtd_pc_usd",
    "GHED_PVT-DCHE_SHA2011": "GHED_pvtd_che",
    "GHED_PHC_pc_US_SHA2011": "GHED_phc_usd_pc",
    "GHED_PHC_GGHE-D_PHC_SHA2011": "GHED_gghed_phc_phc",
}

WORLD_BANK_FINANCING_CODES = {
    "SH.XPD.CHEX.GD.ZS",
    "SH.XPD.CHEX.PC.CD",
    "SH.XPD.GHED.GD.ZS",
    "SH.XPD.GHED.CH.ZS",
    "SH.XPD.GHED.PC.CD",
    "SH.XPD.PVTD.CH.ZS",
    "SH.XPD.OOPC.CH.ZS",
    "SH.XPD.OOPC.PC.CD",
    "SH.XPD.EHEX.CH.ZS",
    "SH.XPD.EHEX.PC.CD",
}

WORLD_BANK_CONTEXT_PREFIXES = (
    "NY.", "GC.", "FP.", "DT.", "BX.", "SI.POV.", "SP.POP.",
)

PROGRAM_FAMILY_PREFIXES: tuple[tuple[str, str], ...] = (
    ("WUENIC_", "immunization_coverage"),
    ("WHO_IMM_", "immunization_financing"),
    ("UNAIDS_FIN_", "hiv_financing"),
    ("UNAIDS_", "hiv_aids"),
    ("PEFA", "public_financial_management"),
    ("GOV_WGI_", "governance"),
    ("IQ.CPA.", "governance"),
    ("WB_FCV_", "fragility_conflict"),
    ("SH.IMM.", "immunization_coverage"),
    ("SH.HIV.", "hiv_aids"),
    ("SH.MLR.", "malaria"),
    ("SH.TBS.", "tuberculosis"),
    ("SH.DYN.", "mortality"),
    ("SH.STA.", "health_nutrition_wash"),
    ("SH.H2O.", "water_sanitation"),
    ("SH.MED.", "health_system_capacity"),
    ("SH.UHC.", "universal_health_coverage"),
    ("SP.DYN.", "demography_health_outcomes"),
    ("SP.ADO.", "reproductive_health"),
    ("SN.ITK.", "nutrition"),
)


def _source_slug(source: str) -> str:
    """Return a stable, readable source component for series IDs."""
    return re.sub(r"[^a-z0-9]+", "_", str(source).strip().lower()).strip("_")


def _classify_domain(source: str, code: str, indicator_name: str = "") -> str:
    """Assign a broad research domain from documented source/code semantics."""
    if source == "WHO GHED" or code in LEGACY_GHED_ALIASES:
        return "health_financing"
    if source in {"WHO Immunization", "Global Fund", "IHME FGH"}:
        return "health_financing"
    if source == "UNAIDS":
        return "health_financing" if code.startswith("UNAIDS_FIN_") else "health_program"
    if source in {"WHO GHO", "WUENIC", "IHME GBD"}:
        return "health_program"
    if source.startswith("PEFA"):
        return "public_financial_management"
    if source in {"IMF", "WGI", "CPIA", "World Bank FCV"}:
        return "country_context"
    if source == "World Bank":
        if code in WORLD_BANK_FINANCING_CODES:
            return "health_financing"
        if code.startswith(WORLD_BANK_CONTEXT_PREFIXES):
            return "country_context"
        return "health_program"
    if source == "OECD Health":
        name = f"{code} {indicator_name}".lower()
        return "health_financing" if any(x in name for x in ("spend", "expend", "financ")) else "health_program"
    return "unclassified"


def _classify_family(source: str, code: str, domain: str) -> str:
    """Assign a useful thematic family without claiming an analytic role."""
    if source == "WHO GHED" or code in LEGACY_GHED_ALIASES:
        return "health_expenditure_accounts"
    for prefix, family in PROGRAM_FAMILY_PREFIXES:
        if code.startswith(prefix):
            return family
    if domain == "public_financial_management":
        return "public_financial_management"
    if domain == "country_context":
        if source == "IMF" or code.startswith(("NY.", "GC.", "FP.", "DT.", "BX.")):
            return "macroeconomic_fiscal"
        if code.startswith(("SP.POP.", "SI.POV.")):
            return "demographic_socioeconomic"
        return "governance_context"
    if domain == "health_financing":
        return "health_expenditure"
    if domain == "health_program":
        return "health_program_other"
    return "unclassified"


def _infer_unit_from_name(name: str) -> str:
    """Conservatively extract a displayed unit from a label's final brackets."""
    match = re.search(r"\(([^()]*)\)\s*$", str(name))
    if not match:
        return ""
    unit = match.group(1).strip()
    return unit if len(unit) <= 80 else ""


def _read_ghed_codebook(workbook: Path) -> pd.DataFrame:
    """Read indicator semantics from the workbook's authoritative Codebook."""
    if not workbook.exists():
        return pd.DataFrame()
    codebook = pd.read_excel(workbook, sheet_name="Codebook")
    codebook.columns = [str(c).strip().lower() for c in codebook.columns]
    rename = {
        "variable code": "ghed_variable_code",
        "variable name": "ghed_variable_name",
        "long code (ghed data explorer)": "ghed_long_code",
        "category 1": "ghed_category_1",
        "category 2": "ghed_category_2",
        "method of measurement (indicators category1)": "ghed_method_of_measurement",
    }
    codebook = codebook.rename(columns=rename)
    wanted = [
        "ghed_variable_code", "ghed_variable_name", "ghed_long_code",
        "ghed_category_1", "ghed_category_2", "unit", "currency",
        "ghed_method_of_measurement",
    ]
    for col in wanted:
        if col not in codebook:
            codebook[col] = ""
    codebook = codebook[wanted].dropna(subset=["ghed_variable_code"]).copy()
    codebook["indicator_code"] = "GHED_" + codebook["ghed_variable_code"].astype(str).str.strip().str.lower()
    codebook = codebook.drop_duplicates("indicator_code")
    return codebook.drop(columns="ghed_variable_code")


def _read_ghed_series_metadata(workbook: Path) -> pd.DataFrame:
    """Read country-series provenance notes without expanding them by year."""
    if not workbook.exists():
        return pd.DataFrame()
    metadata = pd.read_excel(workbook, sheet_name="Metadata")
    metadata.columns = [str(c).strip().lower() for c in metadata.columns]
    rename = {
        "code": "entity_id",
        "variable code": "ghed_variable_code",
        "variable name": "indicator_name",
        "long code (ghed data explorer)": "ghed_long_code",
        "sources": "source_notes",
        "comments": "comments",
        "data type": "data_type_notes",
        "methods of estimation": "estimation_notes",
        "countries and territories footnote": "country_footnote",
    }
    metadata = metadata.rename(columns=rename)
    if "entity_id" not in metadata or "ghed_variable_code" not in metadata:
        return pd.DataFrame()
    metadata["source_entity_code"] = metadata["entity_id"].astype(str).str.strip().str.upper()
    metadata["entity_id"] = metadata["source_entity_code"].replace(ENTITY_ALIASES)
    metadata["indicator_code"] = (
        "GHED_" + metadata["ghed_variable_code"].astype(str).str.strip().str.lower()
    )
    wanted = [
        "entity_id", "source_entity_code", "location", "region", "income",
        "indicator_code", "indicator_name", "ghed_long_code", "source_notes",
        "comments", "data_type_notes", "estimation_notes", "country_footnote",
    ]
    for col in wanted:
        if col not in metadata:
            metadata[col] = ""
    return metadata[wanted].drop_duplicates(["entity_id", "indicator_code"]).reset_index(drop=True)


def build_indicator_dimension(master: pd.DataFrame, workbook: Path = GHED_WORKBOOK) -> pd.DataFrame:
    """Build one auditable record per source-specific indicator series."""
    work = master.copy()
    work["indicator_code"] = work["indicator_code"].astype(str)
    work["source"] = work["source"].astype(str)
    work["indicator_name"] = work["indicator_name"].astype(str)
    grouped = work.groupby(["source", "indicator_code"], observed=True)
    dim = grouped.agg(
        indicator_name=("indicator_name", "first"),
        n_observations=("value", "size"),
        n_source_entities=("iso3", "nunique"),
        first_year=("year", "min"),
        last_year=("year", "max"),
    ).reset_index()

    dim["source_slug"] = dim["source"].map(_source_slug)
    dim["series_id"] = dim["source_slug"] + "::" + dim["indicator_code"]
    dim["canonical_indicator_code"] = dim["indicator_code"].replace(LEGACY_GHED_ALIASES)
    dim["series_role"] = "canonical_source_series"
    legacy = dim["indicator_code"].isin(LEGACY_GHED_ALIASES) & dim["source"].eq("WHO GHO")
    dim.loc[legacy, "series_role"] = "legacy_mirror"
    dim["canonical_source"] = dim["source"]
    dim.loc[legacy, "canonical_source"] = "WHO GHED"
    dim["canonical_series_id"] = (
        dim["canonical_source"].map(_source_slug) + "::" + dim["canonical_indicator_code"]
    )
    dim["include_in_default"] = ~legacy
    dim["research_domain"] = [
        _classify_domain(source, code, name)
        for source, code, name in zip(
            dim["source"], dim["indicator_code"], dim["indicator_name"]
        )
    ]
    dim["indicator_family"] = [
        _classify_family(source, code, domain)
        for source, code, domain in zip(
            dim["source"], dim["indicator_code"], dim["research_domain"]
        )
    ]

    dim["unit"] = ""
    dim["unit_evidence"] = "not_available"
    for idx, row in dim.iterrows():
        registry_item = REGISTRY.get(row["indicator_code"])
        if registry_item:
            dim.at[idx, "unit"] = registry_item.unit
            dim.at[idx, "unit_evidence"] = "project_semantic_registry"
        else:
            inferred = _infer_unit_from_name(row["indicator_name"])
            if inferred:
                dim.at[idx, "unit"] = inferred
                dim.at[idx, "unit_evidence"] = "inferred_from_indicator_label"

    codebook = _read_ghed_codebook(workbook)
    if not codebook.empty:
        dim = dim.merge(codebook, on="indicator_code", how="left")
        ghed_rows = dim["source"].eq("WHO GHED") & dim["unit_y"].notna()
        dim.loc[ghed_rows, "unit_x"] = dim.loc[ghed_rows, "unit_y"].fillna("")
        dim.loc[ghed_rows, "unit_evidence"] = "WHO_GHED_codebook"
        dim = dim.rename(columns={"unit_x": "unit"}).drop(columns="unit_y")
    else:
        for col in (
            "ghed_variable_name", "ghed_long_code", "ghed_category_1",
            "ghed_category_2", "currency", "ghed_method_of_measurement",
        ):
            dim[col] = ""

    dim["source_version"] = ""
    dim.loc[dim["source"].eq("WHO GHED"), "source_version"] = "2025-12-12"
    dim.loc[dim["source"].eq("World Bank FCV"), "source_version"] = FCV_VINTAGE
    return dim.sort_values(["research_domain", "source", "indicator_code"]).reset_index(drop=True)


def build_entity_dimension(master: pd.DataFrame, country_metadata: pd.DataFrame) -> pd.DataFrame:
    """Build a stable entity dimension while keeping aggregate status explicit."""
    work = master.copy()
    work["source_entity_code"] = work["iso3"].astype(str).str.strip().str.upper()
    work["entity_id"] = work["source_entity_code"].replace(ENTITY_ALIASES)
    names = (
        work.groupby("entity_id", observed=True)["country_name"]
        .agg(lambda x: x.dropna().astype(str).iloc[0] if not x.dropna().empty else "")
        .rename("master_entity_name")
        .reset_index()
    )

    metadata = country_metadata.copy()
    metadata["entity_id"] = metadata["iso3"].astype(str).replace(ENTITY_ALIASES)
    if "is_fcs" in metadata:
        metadata = metadata.rename(columns={"is_fcs": "fcv_fy2024"})
    metadata = metadata.drop(columns=["iso3"], errors="ignore")
    dim = names.merge(metadata, on="entity_id", how="left")
    dim["country_name"] = dim["country_name"].fillna(dim["master_entity_name"])
    dim = dim.drop(columns="master_entity_name")

    metadata_entities = set(metadata["entity_id"].astype(str))

    def entity_type(code: str) -> str:
        if code in metadata_entities:
            return "world_bank_economy"
        if pycountry.countries.get(alpha_3=code) is not None:
            return "territory_or_other_economy"
        if code == "ANT":
            return "historical_entity"
        return "aggregate"

    dim["entity_type"] = dim["entity_id"].map(entity_type)
    dim["is_country_or_territory"] = dim["entity_type"].isin(
        ["world_bank_economy", "territory_or_other_economy"]
    )
    dim["is_dashboard_economy"] = dim["entity_id"].isin(metadata_entities)
    dim["fcv_current"] = dim["entity_id"].isin(FCV_CURRENT_ISO3)
    dim["fcv_vintage"] = FCV_VINTAGE
    dim["fcv_reference_year"] = FCV_REFERENCE_YEAR
    return dim.sort_values("entity_id").reset_index(drop=True)


def build_research_observations(
    master: pd.DataFrame,
    indicators: pd.DataFrame,
    entities: pd.DataFrame,
) -> pd.DataFrame:
    """Attach research semantics and stable keys to every master observation."""
    obs = master.copy()
    for col in ("iso3", "indicator_code", "indicator_name", "source"):
        obs[col] = obs[col].astype(str)
    obs = obs.rename(columns={"iso3": "source_entity_code"})
    obs["source_entity_code"] = obs["source_entity_code"].str.strip().str.upper()
    obs["entity_id"] = obs["source_entity_code"].replace(ENTITY_ALIASES)
    indicator_cols = [
        "source", "indicator_code", "series_id", "canonical_indicator_code",
        "canonical_series_id", "series_role", "include_in_default",
        "research_domain", "indicator_family", "source_version",
    ]
    obs = obs.merge(indicators[indicator_cols], on=["source", "indicator_code"], how="left")
    entity_cols = ["entity_id", "entity_type", "is_country_or_territory"]
    obs = obs.merge(entities[entity_cols], on="entity_id", how="left")
    obs["is_preliminary"] = obs["source"].eq("WHO GHED") & obs["year"].eq(2024)
    ordered = [
        "entity_id", "source_entity_code", "country_name", "entity_type",
        "is_country_or_territory", "year", "series_id", "indicator_code",
        "canonical_series_id", "canonical_indicator_code", "indicator_name",
        "research_domain", "indicator_family", "value", "source",
        "source_version", "series_role", "include_in_default", "is_preliminary",
        "pulled_at",
    ]
    return obs[ordered].sort_values(["research_domain", "entity_id", "series_id", "year"]).reset_index(drop=True)


def _write_parquet(df: pd.DataFrame, path: Path) -> None:
    """Write a Parquet file atomically."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    df.to_parquet(tmp, index=False, compression="snappy")
    tmp.replace(path)


def build_research_package(
    master_path: str | Path | None = None,
    metadata_path: str | Path | None = None,
    out_dir: str | Path = RESEARCH_DIR,
    ghed_workbook: str | Path = GHED_WORKBOOK,
) -> dict[str, object]:
    """Create the complete research package and return its validation summary."""
    master_path = Path(master_path or Path(PROCESSED_DIR) / "master.parquet")
    metadata_path = Path(metadata_path or Path(PROCESSED_DIR) / "country_metadata.parquet")
    out_dir = Path(out_dir)
    workbook = Path(ghed_workbook)
    if not master_path.exists():
        raise FileNotFoundError(f"Master data not found: {master_path}")
    if not metadata_path.exists():
        raise FileNotFoundError(f"Country metadata not found: {metadata_path}")
    out_dir.mkdir(parents=True, exist_ok=True)

    master = pd.read_parquet(master_path)
    country_metadata = pd.read_parquet(metadata_path)
    indicators = build_indicator_dimension(master, workbook)
    entities = build_entity_dimension(master, country_metadata)
    observations = build_research_observations(master, indicators, entities)

    aliases = pd.DataFrame(
        [
            {
                "source": "WHO GHO",
                "legacy_indicator_code": legacy,
                "canonical_source": "WHO GHED",
                "canonical_indicator_code": canonical,
                "relationship": "legacy_mirror",
                "default_action": "exclude_legacy_use_canonical",
            }
            for legacy, canonical in sorted(LEGACY_GHED_ALIASES.items())
        ]
    )
    _write_parquet(observations, out_dir / "observations_all_sources.parquet")
    _write_parquet(entities, out_dir / "dim_entities.parquet")
    _write_parquet(indicators, out_dir / "dim_indicators.parquet")
    indicators.to_csv(out_dir / "dim_indicators.csv", index=False)
    _write_parquet(aliases, out_dir / "indicator_aliases.parquet")

    default_obs = observations[
        observations["is_country_or_territory"] & observations["include_in_default"]
    ]
    domain_files = {
        "health_financing": "health_financing.parquet",
        "health_program": "health_programs.parquet",
        "country_context": "country_context.parquet",
        "public_financial_management": "public_financial_management.parquet",
    }
    for domain, filename in domain_files.items():
        _write_parquet(
            default_obs[default_obs["research_domain"].eq(domain)].reset_index(drop=True),
            out_dir / filename,
        )

    ghed_metadata = _read_ghed_series_metadata(workbook)
    if not ghed_metadata.empty:
        _write_parquet(ghed_metadata, out_dir / "ghed_series_metadata.parquet")

    inventory = (
        indicators.groupby(["research_domain", "source"], observed=True)
        .agg(
            indicators=("indicator_code", "size"),
            observations=("n_observations", "sum"),
            entities=("n_source_entities", "max"),
            first_year=("first_year", "min"),
            last_year=("last_year", "max"),
            legacy_mirrors=("series_role", lambda x: int((x == "legacy_mirror").sum())),
        )
        .reset_index()
        .sort_values(["research_domain", "source"])
    )
    inventory.to_csv(out_dir / "inventory_by_domain_source.csv", index=False)

    default_domain_rows = {
        domain: int(default_obs["research_domain"].eq(domain).sum())
        for domain in domain_files
    }
    catalog_lines = [
        "# Research data catalogue",
        "",
        "Generated from the current processed master. Counts below describe source-specific ",
        "indicator series; similarly named series from different sources remain distinct.",
        "",
        "| Domain | Source | Indicators | Observations | Entities | Years | Legacy mirrors |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for row in inventory.itertuples(index=False):
        catalog_lines.append(
            f"| {row.research_domain} | {row.source} | {row.indicators:,} | "
            f"{row.observations:,} | {row.entities:,} | {row.first_year}-{row.last_year} | "
            f"{row.legacy_mirrors:,} |"
        )
    catalog_lines.extend([
        "",
        "The domain convenience files contain only countries/territories and default source series. ",
        "Aggregates and legacy mirrors remain available in `observations_all_sources.parquet`.",
        "",
        "GHED source version: 2025-12-12. The workbook states that 2024 values are preliminary.",
        f"FCV context vintage: {FCV_VINTAGE} (reference year {FCV_REFERENCE_YEAR}).",
        "",
    ])
    (out_dir / "CATALOG.md").write_text("\n".join(catalog_lines), encoding="utf-8")

    duplicate_key = ["source", "source_entity_code", "year", "indicator_code"]
    report: dict[str, object] = {
        "status": "ok",
        "master_path": str(master_path),
        "country_metadata_path": str(metadata_path),
        "observation_rows": len(observations),
        "indicator_series": len(indicators),
        "entities": len(entities),
        "entity_types": {
            str(k): int(v) for k, v in entities["entity_type"].value_counts().items()
        },
        "domain_rows": {
            str(k): int(v) for k, v in observations["research_domain"].value_counts().items()
        },
        "default_domain_file_rows": default_domain_rows,
        "unclassified_indicator_series": int(indicators["research_domain"].eq("unclassified").sum()),
        "duplicate_source_keys": int(observations.duplicated(duplicate_key).sum()),
        "legacy_mirror_rows_retained_in_all_sources": int(
            observations["series_role"].eq("legacy_mirror").sum()
        ),
        "legacy_mirror_rows_in_default_domain_files": 0,
        "ghed_preliminary_2024_rows": int(observations["is_preliminary"].sum()),
        "fcv_current_entities": int(entities["fcv_current"].sum()),
        "fcv_vintage": FCV_VINTAGE,
        "notes": [
            "No imputation, interpolation, winsorisation, deflation, currency conversion, or analytic sample selection was applied.",
            "Aggregates and legacy mirrors are retained in observations_all_sources.parquet but excluded from domain convenience files.",
            "GHED version sheet states that 2024 data are preliminary and subject to revision.",
            "FCV is a current FY2026 contextual classification, not a historical time-varying exposure.",
        ],
    }
    (out_dir / "validation_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    logger.info("Research package written to %s", out_dir)
    return report


if __name__ == "__main__":
    summary = build_research_package()
    print(json.dumps(summary, indent=2))
