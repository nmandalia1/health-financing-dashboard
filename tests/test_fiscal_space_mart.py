"""
test_fiscal_space_mart.py — Unit + integration tests for the fiscal-space
composite mart in pipeline/analytical_marts.py.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline import analytical_marts as am
from pipeline.indicator_registry import HIGHER_BETTER, LOWER_BETTER


class TestNormalisePeer:
    def test_direction_aware_scaling(self):
        sub = pd.DataFrame({"value": [0, 25, 50, 75, 100], "grp": ["A"] * 5})
        hi = am._normalise_peer(sub, HIGHER_BETTER)
        lo = am._normalise_peer(sub, LOWER_BETTER)
        # Midpoint maps near 50 under winsorised P5–P95 min-max.
        assert 45 <= hi.iloc[2] <= 55
        # Higher raw value => higher score when HIGHER_BETTER.
        assert hi.iloc[0] < hi.iloc[4]
        # LOWER_BETTER inverts the ranking.
        assert lo.iloc[0] > lo.iloc[4]
        # The two directions are mirror images about 50.
        assert np.allclose(hi + lo, 100.0)

    def test_degenerate_group_is_neutral(self):
        sub = pd.DataFrame({"value": [7.0, 7.0, 7.0], "grp": ["A"] * 3})
        out = am._normalise_peer(sub, HIGHER_BETTER)
        assert (out == 50.0).all()


def _synthetic_master(countries: list[str], year: int) -> pd.DataFrame:
    """
    Build a master with 5 pillars' worth of indicators across several countries
    so peer normalisation has spread and the index can publish.
    """
    # code -> list of values aligned with `countries`
    data = {
        "NGDP_RPCH":         [2, 4, 6, 8],       # macro
        "GC.TAX.TOTL.GD.ZS": [10, 14, 18, 22],   # revenue
        "GHED_gghed_gge":    [5, 8, 11, 14],      # prioritisation
        "GGXWDG_NGDP":       [80, 60, 40, 20],    # debt (LOWER better)
        "GOV_WGI_GE.EST":    [-1.0, 0.0, 0.5, 1.0],  # pfm
    }
    rows = []
    for code, vals in data.items():
        for iso3, v in zip(countries, vals):
            rows.append({
                "iso3": iso3, "country_name": iso3, "year": year,
                "indicator_code": code, "indicator_name": code,
                "value": float(v), "source": "Test", "pulled_at": "2024",
            })
    return pd.DataFrame(rows)


def _write_processed(tmp_path, master: pd.DataFrame, countries: list[str]) -> None:
    master.to_parquet(tmp_path / "master.parquet", index=False)
    cm = pd.DataFrame({"iso3": countries, "wb_income_group": ["Low income"] * len(countries)})
    cm.to_parquet(tmp_path / "country_metadata.parquet", index=False)


class TestScorableSelection:
    def test_excludes_neutral_context_and_absolute_indicators(self):
        from pipeline.indicator_registry import REGISTRY
        scorable = set(am._scorable_codes(set(REGISTRY.keys())))
        # NEUTRAL (ambiguous direction) excluded:
        assert "GHED_gge_gdp" not in scorable
        # normalization="none" context/absolute indicators excluded:
        assert "DT.ODA.ALLD.CD" not in scorable      # absolute US$
        assert "DT.DOD.DECT.CD" not in scorable      # absolute US$ debt stock
        assert "NGDPDPC" not in scorable             # income level (context)
        assert "NY.GDP.PCAP.CD" not in scorable
        assert "UHC_INDEX_REPORTED" not in scorable  # outcome (feeds efficiency)
        # Genuine scorable indicators remain:
        assert "GC.TAX.TOTL.GD.ZS" in scorable
        assert "GHED_gghed_gge" in scorable


class TestDomainScoringNoDoubleCount:
    def test_overlap_indicator_scores_only_its_domain(self, tmp_path, monkeypatch):
        # GC.REV.XGRT.GD.ZS has domain=revenue but also tags macro + debt.
        # Under domain scoring it must create ONLY a revenue score.
        countries = ["AAA", "BBB", "CCC"]
        rows = []
        for iso3, v in zip(countries, [14.0, 18.0, 22.0]):
            rows.append({
                "iso3": iso3, "country_name": iso3, "year": 2022,
                "indicator_code": "GC.REV.XGRT.GD.ZS", "indicator_name": "rev",
                "value": v, "source": "Test", "pulled_at": "2024",
            })
        _write_processed(tmp_path, pd.DataFrame(rows), countries)
        monkeypatch.setattr(am, "PROCESSED_DIR", str(tmp_path))

        mart = am.build_mart_fiscal_space(save=False)
        assert "pillar_revenue_score" in mart.columns
        # Despite the macro/debt overlap tags, no macro or debt score is created.
        assert "pillar_macro_score" not in mart.columns
        assert "pillar_debt_score" not in mart.columns


class TestEfficiencyProxy:
    def test_rewards_outcomes_relative_to_spend(self):
        le = {"A": 76, "B": 70, "C": 64, "D": 58}      # A best outcomes
        spend = {"A": 50, "B": 120, "C": 250, "D": 500}  # A lowest spend
        rows = []
        for iso3, v in le.items():
            rows.append({"iso3": iso3, "year": 2022, "grp": "Low income",
                         "indicator_code": "SP.DYN.LE00.IN", "value": float(v)})
        for iso3, v in spend.items():
            rows.append({"iso3": iso3, "year": 2022, "grp": "Low income",
                         "indicator_code": "GHED_gghed_pc_usd", "value": float(v)})
        master = pd.DataFrame(rows)

        eff = am._efficiency_score(master)
        # A (great outcomes, low spend) is more efficient than D (poor, costly).
        assert eff.loc[("A", 2022), "eff_score"] > eff.loc[("D", 2022), "eff_score"]
        # Scores are bounded 0–100.
        assert eff["eff_score"].between(0, 100).all()


class TestComponents:
    def test_maps_domain_pillar_and_efficiency_pseudo_parts(self):
        norm_long = pd.DataFrame({
            "iso3": ["AAA", "AAA", "AAA"],
            "year": [2022, 2022, 2022],
            "code": ["GC.TAX.TOTL.GD.ZS", "GGXWDG_NGDP", "GC.REV.XGRT.GD.ZS"],
            "score": [40.0, 60.0, 50.0],
        })
        eff = pd.DataFrame(
            {"attainment": [70.0], "spend": [30.0]},
            index=pd.MultiIndex.from_tuples([("AAA", 2022)], names=["iso3", "year"]),
        )
        comp = am._build_components(norm_long, eff)
        # Domain mapping: tax+revenue → revenue, gross debt → debt.
        assert set(comp[comp.code == "GC.TAX.TOTL.GD.ZS"]["pillar"]) == {"revenue"}
        assert set(comp[comp.code == "GGXWDG_NGDP"]["pillar"]) == {"debt"}
        # GC.REV's primary pillar is revenue (despite macro/debt overlap tags).
        assert set(comp[comp.code == "GC.REV.XGRT.GD.ZS"]["pillar"]) == {"revenue"}
        # Efficiency parts present as pseudo-codes.
        eff_rows = comp[comp.pillar == "efficiency"]
        assert set(eff_rows.code) == {"_outcome_attainment", "_spend_level"}

    def test_non_efficiency_components_average_to_pillar_score(self, tmp_path, monkeypatch):
        countries = ["AAA", "BBB", "CCC", "DDD"]
        _write_processed(tmp_path, _synthetic_master(countries, 2022), countries)
        monkeypatch.setattr(am, "PROCESSED_DIR", str(tmp_path))
        mart = am.build_mart_fiscal_space(save=True).set_index("iso3")
        comp = pd.read_parquet(tmp_path / "mart_fiscal_components.parquet")
        # Debt components for AAA should mean to its pillar_debt_score.
        debt = comp[(comp.iso3 == "AAA") & (comp.pillar == "debt")]
        assert round(debt.norm_score.mean(), 1) == round(mart.loc["AAA", "pillar_debt_score"], 1)


class TestBuildMartFiscalSpace:
    def test_builds_pillar_scores_and_index(self, tmp_path, monkeypatch):
        countries = ["AAA", "BBB", "CCC", "DDD"]
        _write_processed(tmp_path, _synthetic_master(countries, 2022), countries)
        monkeypatch.setattr(am, "PROCESSED_DIR", str(tmp_path))

        mart = am.build_mart_fiscal_space(save=False)

        assert not mart.empty
        # 5 pillars covered (macro, revenue, prioritisation, debt, pfm) >= MIN 4,
        # so the headline index publishes for every country.
        assert mart["fsh_index"].notna().all()
        for key in ("macro", "revenue", "prioritisation", "debt", "pfm"):
            assert f"pillar_{key}_score" in mart.columns

    def test_debt_direction_is_inverted(self, tmp_path, monkeypatch):
        countries = ["AAA", "BBB", "CCC", "DDD"]
        # AAA has the highest debt (80) and DDD the lowest (20).
        _write_processed(tmp_path, _synthetic_master(countries, 2022), countries)
        monkeypatch.setattr(am, "PROCESSED_DIR", str(tmp_path))

        mart = am.build_mart_fiscal_space(save=False).set_index("iso3")
        # Lower debt => better (higher) debt pillar score.
        assert mart.loc["DDD", "pillar_debt_score"] > mart.loc["AAA", "pillar_debt_score"]

    def test_index_gated_by_coverage(self, tmp_path, monkeypatch):
        # Only 2 pillars present (macro + revenue) => below MIN_PILLARS_FOR_INDEX.
        countries = ["AAA", "BBB", "CCC"]
        rows = []
        for code, vals in {"NGDP_RPCH": [2, 5, 8], "GC.TAX.TOTL.GD.ZS": [10, 15, 20]}.items():
            for iso3, v in zip(countries, vals):
                rows.append({
                    "iso3": iso3, "country_name": iso3, "year": 2022,
                    "indicator_code": code, "indicator_name": code,
                    "value": float(v), "source": "Test", "pulled_at": "2024",
                })
        _write_processed(tmp_path, pd.DataFrame(rows), countries)
        monkeypatch.setattr(am, "PROCESSED_DIR", str(tmp_path))

        mart = am.build_mart_fiscal_space(save=False)
        # Rows are kept (pillar scores exist) but the index is withheld.
        assert not mart.empty
        assert mart["fsh_index"].isna().all()
        assert (mart["fsh_index_coverage"] < 0.6).all()
