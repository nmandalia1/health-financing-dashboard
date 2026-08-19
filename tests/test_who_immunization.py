"""
test_who_immunization.py — Unit tests for pipeline/who_immunization.py.

Uses a minimal in-memory Excel workbook to avoid real HTTP calls.
All three indicator sheets are tested: government expenditure, total
expenditure, and government share.
"""

from __future__ import annotations

from io import BytesIO
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from pipeline.utils import STANDARD_COLUMNS
from pipeline.who_immunization import _parse_sheet, fetch_who_immunization


# ─── helpers ──────────────────────────────────────────────────────────────────

def _make_wide_df(
    id_cols: list[str],
    id_rows: list[list],
    years: list[int],
    values: list[list[float]],
) -> pd.DataFrame:
    """Build a wide DataFrame the same shape as an Excel sheet (header + data)."""
    header = id_cols + [float(y) for y in years]
    rows   = [id_row + vals for id_row, vals in zip(id_rows, values)]
    data   = pd.concat(
        [pd.DataFrame([header], columns=range(len(header))),
         pd.DataFrame(rows,     columns=range(len(header)))],
        ignore_index=True,
    )
    # Re-index columns to match how pandas reads the raw Excel (0, 1, 2, …)
    data.columns = range(len(header))
    return data


def _make_xl_mock(sheet_dfs: dict[str, pd.DataFrame]) -> MagicMock:
    """Return a mock pd.ExcelFile whose .parse() returns the given DataFrames."""
    xl = MagicMock()
    xl.__enter__ = lambda s: s
    xl.__exit__  = MagicMock(return_value=False)

    def _parse(sheet, header=None):
        return sheet_dfs[sheet]

    xl.parse.side_effect = _parse
    return xl


# ─── _parse_sheet ─────────────────────────────────────────────────────────────

class TestParseSheet:
    def _make_xl(self) -> MagicMock:
        """Wide sheet: KEN, NGA — 2019 & 2020 data."""
        data = pd.DataFrame([
            ["country", "iso", "report", "region", "income",
             float(2019), float(2020), float(2021)],
            ["Kenya",   "KEN", "yes",   "AFR",    "Low",
             1_000_000.0, 1_200_000.0, 1_400_000.0],
            ["Nigeria", "NGA", "yes",   "AFR",    "Low",
             5_000_000.0, 5_500_000.0, 6_000_000.0],
        ])
        xl = MagicMock()
        xl.parse.return_value = data
        return xl

    def test_returns_standard_columns(self):
        xl = self._make_xl()
        df = _parse_sheet(
            xl, "Government vaccine expenditure",
            ["country", "iso", "report", "region", "income"],
            "WHO_IMM_GOV_VAX_USD", "Govt vaccine expenditure (current USD)",
            2019, 2020, "2024-01-01",
        )
        assert set(STANDARD_COLUMNS).issubset(df.columns)

    def test_correct_indicator_code_and_source(self):
        xl = self._make_xl()
        df = _parse_sheet(
            xl, "Government vaccine expenditure",
            ["country", "iso", "report", "region", "income"],
            "WHO_IMM_GOV_VAX_USD", "Govt vaccine expenditure (current USD)",
            2019, 2020, "2024-01-01",
        )
        assert df["indicator_code"].unique().tolist() == ["WHO_IMM_GOV_VAX_USD"]
        assert (df["source"] == "WHO Immunization").all()

    def test_year_range_filtering(self):
        """Years outside [start_year, end_year] must be excluded."""
        xl = self._make_xl()
        df = _parse_sheet(
            xl, "Government vaccine expenditure",
            ["country", "iso", "report", "region", "income"],
            "WHO_IMM_GOV_VAX_USD", "Govt vaccine expenditure (current USD)",
            2019, 2020, "2024-01-01",
        )
        assert set(df["year"].unique()) == {2019, 2020}
        assert 2021 not in df["year"].values

    def test_drops_nan_values(self):
        """Rows where the value is NaN must be dropped."""
        data = pd.DataFrame([
            ["country", "iso", "report", "region", "income", float(2019)],
            ["Kenya",   "KEN", "yes",   "AFR",    "Low",    float("nan")],
            ["Nigeria", "NGA", "yes",   "AFR",    "Low",    5_000_000.0],
        ])
        xl = MagicMock()
        xl.parse.return_value = data
        df = _parse_sheet(
            xl, "Government vaccine expenditure",
            ["country", "iso", "report", "region", "income"],
            "WHO_IMM_GOV_VAX_USD", "Govt vaccine expenditure (current USD)",
            2019, 2020, "2024-01-01",
        )
        assert "KEN" not in df["iso3"].values
        assert "NGA" in df["iso3"].values

    def test_drops_invalid_iso3(self):
        """Codes that are not 3-char alphabetic must be silently dropped."""
        data = pd.DataFrame([
            ["country",   "iso",    "report", "region", "income", float(2019)],
            ["Kenya",     "KEN",    "yes",    "AFR",    "Low",    1_000_000.0],
            ["Bad Code",  "SDN736", "yes",    "AFR",    "Low",    999.0],
            ["No Code",   "",       "yes",    "AFR",    "Low",    100.0],
        ])
        xl = MagicMock()
        xl.parse.return_value = data
        df = _parse_sheet(
            xl, "Government vaccine expenditure",
            ["country", "iso", "report", "region", "income"],
            "WHO_IMM_GOV_VAX_USD", "Govt vaccine expenditure (current USD)",
            2019, 2020, "2024-01-01",
        )
        assert set(df["iso3"].unique()) == {"KEN"}

    def test_share_sheet_no_report_column(self):
        """The share sheet has no 'report' column — parsing must still work."""
        data = pd.DataFrame([
            ["country", "iso", "region", "income", float(2019), float(2020)],
            ["Kenya",   "KEN", "AFR",   "Low",    0.85,        0.87],
            ["Nigeria", "NGA", "AFR",   "Low",    0.60,        0.62],
        ])
        xl = MagicMock()
        xl.parse.return_value = data
        df = _parse_sheet(
            xl, "Share paid by government",
            ["country", "iso", "region", "income"],
            "WHO_IMM_GOV_SHARE", "Govt share of vaccine expenditure (proportion, 0–1)",
            2019, 2020, "2024-01-01",
        )
        assert not df.empty
        assert set(df["iso3"].unique()) == {"KEN", "NGA"}
        assert df["value"].between(0, 1).all()

    def test_empty_sheet_returns_empty_df(self):
        """If all rows are NaN after filtering, return an empty DataFrame."""
        data = pd.DataFrame([
            ["country", "iso", "report", "region", "income", float(2019)],
            ["Kenya",   "KEN", "yes",   "AFR",    "Low",    float("nan")],
        ])
        xl = MagicMock()
        xl.parse.return_value = data
        df = _parse_sheet(
            xl, "Government vaccine expenditure",
            ["country", "iso", "report", "region", "income"],
            "WHO_IMM_GOV_VAX_USD", "Govt vaccine expenditure (current USD)",
            2019, 2020, "2024-01-01",
        )
        assert df.empty


# ─── fetch_who_immunization ───────────────────────────────────────────────────

class TestFetchWhoImmunization:
    def _gov_sheet(self) -> pd.DataFrame:
        return pd.DataFrame([
            ["country", "iso", "report", "region", "income",
             float(2019), float(2020)],
            ["Kenya",   "KEN", "yes",   "AFR",    "Low",
             1_000_000.0, 1_200_000.0],
            ["Nigeria", "NGA", "yes",   "AFR",    "Low",
             5_000_000.0, 5_500_000.0],
        ])

    def _tot_sheet(self) -> pd.DataFrame:
        return pd.DataFrame([
            ["country", "iso", "report", "region", "income",
             float(2019), float(2020)],
            ["Kenya",   "KEN", "yes",   "AFR",    "Low",
             2_000_000.0, 2_200_000.0],
            ["Nigeria", "NGA", "yes",   "AFR",    "Low",
             8_000_000.0, 9_000_000.0],
        ])

    def _share_sheet(self) -> pd.DataFrame:
        return pd.DataFrame([
            ["country", "iso", "region", "income", float(2019), float(2020)],
            ["Kenya",   "KEN", "AFR",   "Low",    0.50,        0.55],
            ["Nigeria", "NGA", "AFR",   "Low",    0.63,        0.61],
        ])

    def _mock_xl(self) -> MagicMock:
        sheets = {
            "Government vaccine expenditure": self._gov_sheet(),
            "Total vaccine expenditure":      self._tot_sheet(),
            "Share paid by government":       self._share_sheet(),
        }
        xl = MagicMock()
        xl.parse.side_effect = lambda sheet, header=None: sheets[sheet]
        xl.close = MagicMock()
        return xl

    def test_returns_standard_df(self):
        with patch("pipeline.who_immunization.cache_is_fresh", return_value=True), \
             patch("pipeline.who_immunization.pd.ExcelFile", return_value=self._mock_xl()), \
             patch("pipeline.who_immunization.save_data"):
            df = fetch_who_immunization(start_year=2019, end_year=2020, save=False)

        assert not df.empty
        assert set(STANDARD_COLUMNS).issubset(df.columns)

    def test_all_three_indicators_present(self):
        with patch("pipeline.who_immunization.cache_is_fresh", return_value=True), \
             patch("pipeline.who_immunization.pd.ExcelFile", return_value=self._mock_xl()), \
             patch("pipeline.who_immunization.save_data"):
            df = fetch_who_immunization(start_year=2019, end_year=2020, save=False)

        codes = set(df["indicator_code"].unique())
        assert "WHO_IMM_GOV_VAX_USD" in codes
        assert "WHO_IMM_TOT_VAX_USD" in codes
        assert "WHO_IMM_GOV_SHARE"   in codes

    def test_source_label_is_correct(self):
        with patch("pipeline.who_immunization.cache_is_fresh", return_value=True), \
             patch("pipeline.who_immunization.pd.ExcelFile", return_value=self._mock_xl()), \
             patch("pipeline.who_immunization.save_data"):
            df = fetch_who_immunization(start_year=2019, end_year=2020, save=False)

        assert (df["source"] == "WHO Immunization").all()

    def test_stale_cache_triggers_download(self):
        """When cache is stale, _download_excel must be called exactly once."""
        with patch("pipeline.who_immunization.cache_is_fresh", return_value=False), \
             patch("pipeline.who_immunization._download_excel") as mock_dl, \
             patch("pipeline.who_immunization.pd.ExcelFile", return_value=self._mock_xl()), \
             patch("pipeline.who_immunization.save_data"):
            fetch_who_immunization(start_year=2019, end_year=2020, save=False)

        mock_dl.assert_called_once()

    def test_fresh_cache_skips_download(self):
        """When cache is fresh, _download_excel must NOT be called."""
        with patch("pipeline.who_immunization.cache_is_fresh", return_value=True), \
             patch("pipeline.who_immunization._download_excel") as mock_dl, \
             patch("pipeline.who_immunization.pd.ExcelFile", return_value=self._mock_xl()), \
             patch("pipeline.who_immunization.save_data"):
            fetch_who_immunization(start_year=2019, end_year=2020, save=False)

        mock_dl.assert_not_called()
