"""
test_world_bank.py — Unit tests for pipeline/world_bank.py.

Uses unittest.mock to avoid real wbgapi calls.
Key scenarios tested:
  - Successful fetch returns standard DataFrame
  - Timeout is handled gracefully (no crash, log_skip called)
  - Cache hit avoids re-fetching
  - Aggregate / region codes are filtered out
"""

from __future__ import annotations

from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from pipeline.world_bank import _fetch_one_indicator
from pipeline.utils import STANDARD_COLUMNS


def _make_wb_raw_df(codes: list[str], years: list[int]) -> pd.DataFrame:
    """Build a fake wbgapi DataFrame output (economy × year)."""
    import itertools
    rows = {
        "economy": [c for c, _ in itertools.product(codes, years)],
        **{str(y): [float(i + y) for i, _ in enumerate(codes)] * 1 for y in years},
    }
    df = pd.DataFrame(rows).set_index("economy")
    # wbgapi returns years as column names
    return df


class TestFetchOneIndicator:
    @patch("pipeline.world_bank.wb.data.DataFrame")
    def test_returns_standard_df(self, mock_wb):
        """Happy path: wbgapi returns data, we get a standard DataFrame back."""
        raw = pd.DataFrame({
            "economy": ["KEN", "NGA", "ZAF"],
            2020: [5.0, 6.0, 7.0],
            2021: [5.5, 6.5, 7.5],
        }).set_index("economy")
        mock_wb.return_value = raw

        df = _fetch_one_indicator("SH.XPD.CHEX.GD.ZS", "CHE % GDP", 2000, 2023, "2024-01-01")
        assert df is not None
        assert set(STANDARD_COLUMNS).issubset(df.columns)
        assert df["source"].iloc[0] == "World Bank"
        assert df["indicator_code"].iloc[0] == "SH.XPD.CHEX.GD.ZS"

    @patch("pipeline.world_bank.wb.data.DataFrame")
    def test_filters_aggregate_codes(self, mock_wb):
        """Rows where iso3 is not exactly 3 chars or contains a digit are dropped.

        The filter is purely structural (length == 3 AND no digit).
        It does NOT maintain a blocklist, so 3-char all-alpha codes like WLD and EAP
        pass through even though they represent World Bank aggregate regions.
        ZZZ1 (4 chars) and Z1Z (contains digit) are both dropped.
        """
        raw = pd.DataFrame({
            "economy": ["KEN", "WLD", "EAP", "ZZZ1", "Z1Z"],
            2020: [5.0, 100.0, 80.0, 99.0, 88.0],
        }).set_index("economy")
        mock_wb.return_value = raw

        df = _fetch_one_indicator("TEST", "Test", 2000, 2023, "2024-01-01")
        assert df is not None
        # Only 3-char, digit-free codes survive
        assert set(df["iso3"].unique()) == {"KEN", "WLD", "EAP"}
        # Codes with a digit or wrong length are dropped
        assert "ZZZ1" not in df["iso3"].values
        assert "Z1Z" not in df["iso3"].values

    def test_timeout_returns_none_and_logs(self):
        """A timeout from resilient_fetch should return None and log 'timeout'."""
        with patch(
            "pipeline.world_bank.resilient_fetch",
            side_effect=FuturesTimeoutError(),
        ), patch("pipeline.world_bank.log_skip") as mock_log:
            df = _fetch_one_indicator("SLOW_IND", "Slow", 2000, 2023, "2024-01-01")

        assert df is None
        mock_log.assert_called_once()
        assert mock_log.call_args[0][3] == "timeout"

    @patch("pipeline.utils.time.sleep")  # don't actually sleep between retries
    @patch("pipeline.world_bank.wb.data.DataFrame")
    def test_transient_error_is_retried_then_succeeds(self, mock_wb, _sleep):
        """A transient API error on the first attempt should be retried, not dropped."""
        good = pd.DataFrame({
            "economy": ["KEN", "NGA"],
            2020: [5.0, 6.0],
        }).set_index("economy")
        # First call raises a malformed-JSON-style error, second call succeeds.
        mock_wb.side_effect = [Exception("APIError: JSON decoding error"), good]

        with patch("pipeline.world_bank.log_skip") as mock_log:
            df = _fetch_one_indicator("FLAKY", "Flaky", 2000, 2023, "2024-01-01")

        assert df is not None
        assert set(df["iso3"].unique()) == {"KEN", "NGA"}
        assert mock_wb.call_count == 2          # retried once
        mock_log.assert_not_called()            # no skip logged on eventual success

    @patch("pipeline.utils.time.sleep")
    @patch("pipeline.world_bank.wb.data.DataFrame")
    def test_persistent_error_gives_up_and_logs_api_error(self, mock_wb, _sleep):
        """If every attempt fails, return None and log a single api_error skip."""
        mock_wb.side_effect = Exception("APIError: JSON decoding error")

        with patch("pipeline.world_bank.log_skip") as mock_log:
            df = _fetch_one_indicator("BROKEN", "Broken", 2000, 2023, "2024-01-01")

        assert df is None
        assert mock_wb.call_count == 3          # exhausted max_retries
        mock_log.assert_called_once()
        assert mock_log.call_args[0][3] == "api_error"

    @patch("pipeline.utils.time.sleep")
    @patch("pipeline.world_bank.wb.data.DataFrame")
    def test_404_is_not_retried(self, mock_wb, _sleep):
        """A 404 is permanent — fail fast without burning retries."""
        mock_wb.side_effect = Exception("404 Not Found")

        with patch("pipeline.world_bank.log_skip") as mock_log:
            df = _fetch_one_indicator("MISSING", "Missing", 2000, 2023, "2024-01-01")

        assert df is None
        assert mock_wb.call_count == 1          # no retries on 404
        mock_log.assert_called_once()
        assert mock_log.call_args[0][3] == "http_404"

    @patch("pipeline.world_bank.wb.data.DataFrame")
    def test_empty_response_returns_none_and_logs(self, mock_wb):
        """All-null wbgapi result should be treated as no_data."""
        raw = pd.DataFrame({
            "economy": ["KEN"],
            2020: [None],
        }).set_index("economy")
        mock_wb.return_value = raw

        with patch("pipeline.world_bank.log_skip") as mock_log:
            df = _fetch_one_indicator("EMPTY", "Empty", 2000, 2023, "2024-01-01")

        assert df is None
        mock_log.assert_called_once()
        assert mock_log.call_args[0][3] == "no_data"


class TestCacheBehaviour:
    @patch("pipeline.world_bank._load_cached")
    @patch("pipeline.world_bank._fetch_one_indicator")
    def test_cache_hit_skips_fetch(self, mock_fetch, mock_cache, tmp_path):
        """If a cached file exists, _fetch_one_indicator should not be called."""
        from pipeline.utils import make_standard_df
        from tests.conftest import make_record

        cached_df = make_standard_df([make_record(indicator_code="SH.XPD.CHEX.GD.ZS")])
        mock_cache.return_value = cached_df

        from pipeline.world_bank import fetch_world_bank
        with patch("pipeline.world_bank.save_data"):
            fetch_world_bank(
                indicators={"SH.XPD.CHEX.GD.ZS": "CHE % GDP"},
                save=False,
            )

        mock_fetch.assert_not_called()
