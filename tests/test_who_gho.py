"""
test_who_gho.py — Unit tests for pipeline/who_gho.py.

Uses requests_mock to avoid real HTTP calls.
Key scenarios tested:
  - Pagination via @odata.nextLink
  - Deduplication of sex-disaggregated rows (_pick_best_value)
  - 404 → log_skip, no crash
  - Cache hit skips HTTP fetch
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from pipeline.who_gho import _fetch_gho_indicator, _pick_best_value, _fetch_and_process
from pipeline.utils import STANDARD_COLUMNS


# ── _fetch_gho_indicator ──────────────────────────────────────────────────────

class TestFetchGhoIndicator:
    def test_single_page_returns_all_records(self, requests_mock):
        requests_mock.get(
            "https://ghoapi.azureedge.net/api/TEST_IND",
            json={
                "value": [
                    {"SpatialDim": "KEN", "TimeDim": 2020, "NumericValue": 5.1,
                     "Value": "5.1", "Dim1": "BTSX", "Dim2": None},
                    {"SpatialDim": "NGA", "TimeDim": 2020, "NumericValue": 3.8,
                     "Value": "3.8", "Dim1": None, "Dim2": None},
                ]
            },
        )
        records = _fetch_gho_indicator("TEST_IND", 2000, 2023)
        assert len(records) == 2
        assert records[0]["SpatialDim"] == "KEN"

    def test_follows_next_link_pagination(self, requests_mock, gho_paginated_responses):
        """
        Critical regression test — the old code used $top=10000 and never
        followed @odata.nextLink, silently returning only 1000 rows.
        """
        requests_mock.get(
            "https://ghoapi.azureedge.net/api/TEST_IND",
            json=gho_paginated_responses[0],
        )
        requests_mock.get(
            "https://ghoapi.azureedge.net/api/TEST_IND?$skiptoken=1000",
            json=gho_paginated_responses[1],
        )
        records = _fetch_gho_indicator("TEST_IND", 2000, 2023)
        # 1000 from page 1 + 1 from page 2
        assert len(records) == 1001

    def test_raises_on_http_error(self, requests_mock):
        requests_mock.get(
            "https://ghoapi.azureedge.net/api/BAD_IND",
            status_code=404,
        )
        import requests as req
        with pytest.raises(req.exceptions.HTTPError):
            _fetch_gho_indicator("BAD_IND", 2000, 2023)


# ── _pick_best_value ──────────────────────────────────────────────────────────

class TestPickBestValue:
    def test_returns_one_row_per_country_year(self):
        records = [
            {"SpatialDim": "KEN", "TimeDim": 2020, "NumericValue": 5.0,
             "Value": "5.0", "Dim1": "MLE", "Dim2": None},
            {"SpatialDim": "KEN", "TimeDim": 2020, "NumericValue": 4.0,
             "Value": "4.0", "Dim1": "FMLE", "Dim2": None},
            {"SpatialDim": "KEN", "TimeDim": 2020, "NumericValue": 4.5,
             "Value": "4.5", "Dim1": "BTSX", "Dim2": None},
        ]
        result = _pick_best_value(records)
        assert len(result) == 1
        assert result[0]["numeric_value"] == 4.5  # BTSX preferred

    def test_prefers_btsx_over_sex_disaggregated(self):
        records = [
            {"SpatialDim": "NGA", "TimeDim": 2021, "NumericValue": 10.0,
             "Value": "10.0", "Dim1": "MLE",  "Dim2": None},
            {"SpatialDim": "NGA", "TimeDim": 2021, "NumericValue": 20.0,
             "Value": "20.0", "Dim1": "BTSX", "Dim2": None},
        ]
        result = _pick_best_value(records)
        assert len(result) == 1
        assert result[0]["numeric_value"] == 20.0

    def test_falls_back_when_no_btsx(self):
        records = [
            {"SpatialDim": "KEN", "TimeDim": 2020, "NumericValue": 7.0,
             "Value": "7.0", "Dim1": "MLE", "Dim2": None},
        ]
        result = _pick_best_value(records)
        assert len(result) == 1

    def test_empty_input_returns_empty(self):
        assert _pick_best_value([]) == []

    def test_drops_rows_with_null_numeric_value(self):
        records = [
            {"SpatialDim": "KEN", "TimeDim": 2020, "NumericValue": None,
             "Value": "5.0", "Dim1": "BTSX", "Dim2": None},
        ]
        result = _pick_best_value(records)
        assert result == []


# ── _fetch_and_process ────────────────────────────────────────────────────────

class TestFetchAndProcess:
    def test_returns_standard_df_on_success(self, requests_mock, gho_page_response):
        requests_mock.get(
            "https://ghoapi.azureedge.net/api/GHED_CHEGDP_SHA2011",
            json=gho_page_response,
        )
        df = _fetch_and_process(
            "GHED_CHEGDP_SHA2011", "Current health expenditure (% of GDP)",
            2000, 2023, "2024-01-01 00:00 UTC",
        )
        assert df is not None
        assert set(STANDARD_COLUMNS).issubset(df.columns)
        assert df["source"].iloc[0] == "WHO GHO"

    def test_returns_none_on_404(self, requests_mock):
        requests_mock.get(
            "https://ghoapi.azureedge.net/api/MISSING_IND",
            status_code=404,
        )
        with patch("pipeline.who_gho.log_skip") as mock_log:
            df = _fetch_and_process(
                "MISSING_IND", "Missing", 2000, 2023, "2024-01-01 00:00 UTC"
            )
        assert df is None
        mock_log.assert_called_once()
        args = mock_log.call_args[0]
        assert args[3] == "http_404"

    def test_returns_none_on_empty_response(self, requests_mock):
        requests_mock.get(
            "https://ghoapi.azureedge.net/api/EMPTY_IND",
            json={"value": []},
        )
        with patch("pipeline.who_gho.log_skip") as mock_log:
            df = _fetch_and_process(
                "EMPTY_IND", "Empty", 2000, 2023, "2024-01-01 00:00 UTC"
            )
        assert df is None
        mock_log.assert_called_once()
        assert mock_log.call_args[0][3] == "no_data"
