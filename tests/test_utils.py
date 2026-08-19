"""
test_utils.py — Unit tests for pipeline/utils.py.

Covers: make_standard_df, validate_standard_df, cast_master_dtypes,
        standardise_iso3, get_country_name, cache_is_fresh,
        save_data / load_data atomic writes.
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
import pytest

from pipeline.utils import (
    STANDARD_COLUMNS,
    DataQualityError,
    cache_is_fresh,
    cast_master_dtypes,
    get_country_name,
    load_data,
    make_standard_df,
    save_data,
    standardise_iso3,
    validate_standard_df,
)
from pipeline.utils import resilient_fetch
from tests.conftest import make_record


# ── make_standard_df ──────────────────────────────────────────────────────────

class TestMakeStandardDf:
    def test_returns_all_standard_columns(self, sample_records):
        df = make_standard_df(sample_records)
        for col in STANDARD_COLUMNS:
            assert col in df.columns

    def test_drops_null_value_rows(self):
        records = [make_record(value=None), make_record(value=42.0)]
        df = make_standard_df(records)
        assert len(df) == 1
        assert df.iloc[0]["value"] == 42.0

    def test_drops_null_iso3_rows(self):
        records = [make_record(iso3=None), make_record(iso3="KEN")]
        df = make_standard_df(records)
        assert len(df) == 1

    def test_coerces_value_to_float(self):
        records = [make_record(value="3.14")]
        df = make_standard_df(records)
        assert df.iloc[0]["value"] == pytest.approx(3.14)

    def test_coerces_year_to_int(self):
        records = [make_record(year="2020")]
        df = make_standard_df(records)
        assert int(df.iloc[0]["year"]) == 2020

    def test_sorted_by_iso3_indicator_year(self, sample_records):
        df = make_standard_df(sample_records)
        for i in range(len(df) - 1):
            a, b = df.iloc[i], df.iloc[i + 1]
            assert (a["iso3"], a["indicator_code"], int(a["year"])) <= (
                b["iso3"], b["indicator_code"], int(b["year"])
            )

    def test_empty_records_returns_empty_df(self):
        df = make_standard_df([])
        assert df.empty
        assert set(STANDARD_COLUMNS).issubset(df.columns)


# ── validate_standard_df ─────────────────────────────────────────────────────

class TestValidateStandardDf:
    def test_passes_on_valid_df(self, sample_df):
        validate_standard_df(sample_df, "Test")  # should not raise

    def test_raises_on_missing_column(self, sample_df):
        bad = sample_df.drop(columns=["value"])
        with pytest.raises(DataQualityError, match="Missing columns"):
            validate_standard_df(bad, "Test")

    def test_raises_on_bad_iso3(self):
        records = [make_record(iso3="TOOLONG")]
        df = make_standard_df(records)
        # Manually reinsert bad row bypassing make_standard_df filtering
        bad_row = pd.DataFrame([{**make_record(), "iso3": "TOOLONG"}])
        df_bad  = pd.concat([sample_df_from_records(), bad_row], ignore_index=True)
        with pytest.raises(DataQualityError, match="non-3-char iso3"):
            validate_standard_df(df_bad, "Test")

    def test_raises_when_value_mostly_null(self):
        records = [make_record(value=None) for _ in range(9)] + [make_record(value=1.0)]
        df = pd.DataFrame(records, columns=STANDARD_COLUMNS)
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        with pytest.raises(DataQualityError, match="null"):
            validate_standard_df(df, "Test")

    def test_skips_checks_on_empty_df(self, sample_df):
        # Empty df should not raise DataQualityError
        empty = sample_df.iloc[0:0]
        validate_standard_df(empty, "Test")  # should not raise


def sample_df_from_records():
    return make_standard_df([make_record(iso3="KEN"), make_record(iso3="NGA")])


# ── cast_master_dtypes ────────────────────────────────────────────────────────

class TestCastMasterDtypes:
    def test_iso3_becomes_category(self, sample_df):
        df = cast_master_dtypes(sample_df)
        assert str(df["iso3"].dtype) == "category"

    def test_source_becomes_category(self, sample_df):
        df = cast_master_dtypes(sample_df)
        assert str(df["source"].dtype) == "category"

    def test_value_is_float(self, sample_df):
        df = cast_master_dtypes(sample_df)
        assert df["value"].dtype == float

    def test_does_not_mutate_input(self, sample_df):
        original_dtype = str(sample_df["iso3"].dtype)
        cast_master_dtypes(sample_df)
        assert str(sample_df["iso3"].dtype) == original_dtype


# ── standardise_iso3 / get_country_name ──────────────────────────────────────

class TestCountryHelpers:
    def test_standardise_known_code(self):
        assert standardise_iso3("KEN") == "KEN"

    def test_standardise_with_source_map(self):
        assert standardise_iso3("KSV", {"KSV": "XKX"}) == "XKX"

    def test_standardise_unknown_returns_original(self):
        assert standardise_iso3("ZZZ") == "ZZZ"

    def test_get_country_name_kenya(self):
        name = get_country_name("KEN")
        assert "Kenya" in name

    def test_get_country_name_unknown_returns_code(self):
        assert get_country_name("ZZZ") == "ZZZ"


# ── cache_is_fresh ────────────────────────────────────────────────────────────

class TestCacheIsFresh:
    def test_missing_file_returns_false(self, tmp_path):
        assert cache_is_fresh(tmp_path / "missing.parquet") is False

    def test_new_file_is_fresh(self, tmp_path):
        p = tmp_path / "fresh.parquet"
        p.write_text("x")
        assert cache_is_fresh(p, max_age_days=30) is True

    def test_zero_age_days_always_stale(self, tmp_path):
        p = tmp_path / "file.parquet"
        p.write_text("x")
        assert cache_is_fresh(p, max_age_days=0) is False


# ── save_data / load_data (atomic write) ─────────────────────────────────────

class TestSaveLoadData:
    def test_roundtrip(self, sample_df, tmp_path):
        save_data(sample_df, "test", str(tmp_path))
        loaded = load_data("test", str(tmp_path))
        assert loaded is not None
        assert len(loaded) == len(sample_df)

    def test_only_parquet_written_no_csv(self, sample_df, tmp_path):
        """save_data must write Parquet only — CSV is not produced (too large)."""
        save_data(sample_df, "test", str(tmp_path))
        assert (tmp_path / "test.parquet").exists()
        assert not (tmp_path / "test.csv").exists(), "CSV should not be written"

    def test_no_tmp_file_left_on_success(self, sample_df, tmp_path):
        save_data(sample_df, "test", str(tmp_path))
        tmp_files = list(tmp_path.glob("*.tmp.parquet"))
        assert tmp_files == [], f"Leftover tmp files: {tmp_files}"

    def test_load_data_returns_none_when_missing(self, tmp_path):
        result = load_data("nonexistent", str(tmp_path))
        assert result is None


# ── resilient_fetch ───────────────────────────────────────────────────────────

class TestResilientFetch:
    def test_returns_value_on_success(self):
        assert resilient_fetch(lambda: 42) == 42

    def test_retries_transient_then_succeeds(self, monkeypatch):
        monkeypatch.setattr("pipeline.utils.time.sleep", lambda _s: None)
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("JSON decoding error")
            return "ok"

        assert resilient_fetch(flaky, max_retries=3, backoff=0) == "ok"
        assert calls["n"] == 3

    def test_raises_after_exhausting_retries(self, monkeypatch):
        monkeypatch.setattr("pipeline.utils.time.sleep", lambda _s: None)
        calls = {"n": 0}

        def always_fail():
            calls["n"] += 1
            raise RuntimeError("JSON decoding error")

        with pytest.raises(RuntimeError):
            resilient_fetch(always_fail, max_retries=3, backoff=0)
        assert calls["n"] == 3

    def test_404_is_not_retried(self, monkeypatch):
        monkeypatch.setattr("pipeline.utils.time.sleep", lambda _s: None)
        calls = {"n": 0}

        def not_found():
            calls["n"] += 1
            raise RuntimeError("404 Not Found")

        with pytest.raises(RuntimeError, match="404"):
            resilient_fetch(not_found, max_retries=3, backoff=0)
        assert calls["n"] == 1  # failed fast, no retries
