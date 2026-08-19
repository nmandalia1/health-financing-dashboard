"""
test_pipeline_output.py — Integration-style tests that validate the
master Parquet file produced by the pipeline.

These tests run against the real data/processed/master.parquet file.
They are skipped automatically if that file doesn't exist yet
(e.g. on a fresh clone before the first pipeline run).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from pipeline.config import END_YEAR, PROCESSED_DIR, START_YEAR
from pipeline.utils import STANDARD_COLUMNS

MASTER_PATH = Path(PROCESSED_DIR) / "master.parquet"


def test_manifest_marks_zero_row_source_empty(tmp_path, monkeypatch):
    """A completed call with no rows must not be reported as successful data."""
    import json

    import run_pipeline

    monkeypatch.setattr(run_pipeline, "LOGS_DIR", str(tmp_path))
    run_pipeline._write_manifest(
        run_started_at="2026-01-01 00:00 UTC",
        elapsed_seconds=1.0,
        results={"available": 10, "missing_download": 0},
        failures={},
        master_rows=10,
        master_countries=1,
        master_indicators=1,
    )
    manifest = json.loads((tmp_path / "pipeline_manifest.json").read_text())
    assert manifest["sources"]["available"]["status"] == "ok"
    assert manifest["sources"]["missing_download"]["status"] == "empty"


@pytest.fixture(scope="module")
def master() -> pd.DataFrame:
    if not MASTER_PATH.exists():
        pytest.skip("master.parquet not found — run the pipeline first")
    return pd.read_parquet(MASTER_PATH)


class TestMasterParquetShape:
    def test_has_all_standard_columns(self, master):
        for col in STANDARD_COLUMNS:
            assert col in master.columns, f"Missing column: {col}"

    def test_has_rows(self, master):
        assert len(master) > 0, "master.parquet is empty"

    def test_has_multiple_countries(self, master):
        assert master["iso3"].nunique() > 50, "Expected >50 countries"

    def test_has_multiple_indicators(self, master):
        assert master["indicator_code"].nunique() > 20, "Expected >20 indicators"

    def test_has_multiple_sources(self, master):
        assert master["source"].nunique() >= 2, "Expected at least 2 sources"


class TestMasterParquetIntegrity:
    def test_no_null_iso3(self, master):
        nulls = master["iso3"].isna().sum()
        assert nulls == 0, f"{nulls} null iso3 values"

    def test_iso3_length_is_three(self, master):
        bad = master[master["iso3"].astype(str).str.len() != 3]
        assert bad.empty, f"{len(bad)} rows with non-3-char iso3: {bad['iso3'].unique()[:5]}"

    def test_no_null_indicator_code(self, master):
        nulls = master["indicator_code"].isna().sum()
        assert nulls == 0, f"{nulls} null indicator_code values"

    def test_years_within_pipeline_range(self, master):
        years = pd.to_numeric(master["year"], errors="coerce")
        out = master[(years < START_YEAR) | (years > END_YEAR)]
        assert out.empty, (
            f"{len(out)} rows outside {START_YEAR}–{END_YEAR}: "
            f"{sorted(out['year'].unique())[:5]}"
        )

    def test_value_is_numeric(self, master):
        non_numeric = master["value"].apply(
            lambda v: not isinstance(v, (int, float))
        ).sum()
        assert non_numeric == 0, f"{non_numeric} non-numeric value entries"

    def test_no_duplicate_rows(self, master):
        dups = master.duplicated(subset=["iso3", "year", "indicator_code", "source"]).sum()
        assert dups == 0, f"{dups} duplicate (iso3, year, indicator_code, source) rows"

    def test_value_null_rate_below_threshold(self, master):
        null_rate = master["value"].isna().mean()
        assert null_rate < 0.05, f"Value null rate is {null_rate:.1%} — too high"


class TestMasterParquetCoverage:
    def test_world_bank_present(self, master):
        assert "World Bank" in master["source"].values

    def test_who_gho_present(self, master):
        assert "WHO GHO" in master["source"].values

    def test_imf_present(self, master):
        assert "IMF" in master["source"].values

    def test_who_immunization_present(self, master):
        assert "WHO Immunization" in master["source"].values

    def test_who_immunization_indicators_present(self, master):
        imm = master[master["source"] == "WHO Immunization"]
        codes = set(imm["indicator_code"].unique())
        assert "WHO_IMM_GOV_VAX_USD" in codes, "Missing govt vaccine expenditure"
        assert "WHO_IMM_TOT_VAX_USD" in codes, "Missing total vaccine expenditure"
        assert "WHO_IMM_GOV_SHARE"   in codes, "Missing govt share indicator"

    def test_who_immunization_year_range(self, master):
        imm_years = pd.to_numeric(
            master.loc[master["source"] == "WHO Immunization", "year"],
            errors="coerce",
        ).dropna()
        assert imm_years.min() <= 2010, f"Immunization data starts at {imm_years.min()}"
        assert imm_years.max() >= 2019, f"Immunization data ends at {imm_years.max()}"

    def test_who_immunization_share_between_0_and_1(self, master):
        """Govt share values must be a proportion, not a percentage."""
        share = master[
            (master["source"] == "WHO Immunization")
            & (master["indicator_code"] == "WHO_IMM_GOV_SHARE")
        ]["value"]
        assert share.dropna().between(0, 1).all(), (
            "WHO_IMM_GOV_SHARE values outside 0–1 range"
        )

    def test_health_expenditure_indicator_present(self, master):
        """Core health financing indicator must be in the dataset."""
        assert "SH.XPD.CHEX.GD.ZS" in master["indicator_code"].values

    def test_maternal_mortality_indicator_present(self, master):
        assert "SH.STA.MMRT" in master["indicator_code"].values

    def test_year_range_adequately_covered(self, master):
        years = pd.to_numeric(master["year"], errors="coerce").dropna()
        assert years.min() <= 2005, f"Earliest year is {years.min()}, expected ≤2005"
        assert years.max() >= 2019, f"Latest year is {years.max()}, expected ≥2019"
