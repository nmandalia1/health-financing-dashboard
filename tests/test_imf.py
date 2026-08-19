"""
test_imf.py — Unit tests for pipeline/imf.py.

Uses requests_mock to avoid real HTTP calls.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from pipeline.imf import _fetch_imf_indicator, fetch_imf
from pipeline.utils import STANDARD_COLUMNS


IMF_MOCK_RESPONSE = {
    "values": {
        "NGDPDPC": {
            "KEN": {"2020": 1838.0, "2021": 2005.0, "2022": 2082.0},
            "NGA": {"2020": 2097.0, "2021": 2115.0, "2022": 2145.0},
            "USA": {"2020": 63530.0, "2021": 70248.0, "2022": 76399.0},
        }
    }
}


class TestFetchImfIndicator:
    def test_returns_country_dict(self, requests_mock):
        requests_mock.get(
            "https://www.imf.org/external/datamapper/api/v1/NGDPDPC",
            json=IMF_MOCK_RESPONSE,
        )
        data = _fetch_imf_indicator("NGDPDPC")
        assert "KEN" in data
        assert "2020" in data["KEN"]
        assert data["KEN"]["2020"] == 1838.0

    def test_raises_on_404(self, requests_mock):
        requests_mock.get(
            "https://www.imf.org/external/datamapper/api/v1/BAD",
            status_code=404,
        )
        import requests as req
        with pytest.raises(req.exceptions.HTTPError):
            _fetch_imf_indicator("BAD")


class TestFetchImf:
    def test_returns_standard_df(self, requests_mock):
        requests_mock.get(
            "https://www.imf.org/external/datamapper/api/v1/NGDPDPC",
            json=IMF_MOCK_RESPONSE,
        )
        with patch("pipeline.imf._load_cached", return_value=None), \
             patch("pipeline.imf._save_cached"), \
             patch("pipeline.imf.save_data"):
            df = fetch_imf(
                indicators={"NGDPDPC": "GDP per capita"},
                start_year=2020,
                end_year=2022,
                save=False,
            )

        assert df is not None and not df.empty
        assert set(STANDARD_COLUMNS).issubset(df.columns)
        assert set(df["iso3"].unique()) == {"KEN", "NGA", "USA"}
        assert df["source"].iloc[0] == "IMF"

    def test_filters_out_projection_years(self, requests_mock):
        """Years beyond END_YEAR must be excluded (IMF includes projections)."""
        future_response = {
            "values": {
                "NGDPDPC": {
                    "KEN": {"2023": 2500.0, "2025": 2800.0, "2030": 3500.0}
                }
            }
        }
        requests_mock.get(
            "https://www.imf.org/external/datamapper/api/v1/NGDPDPC",
            json=future_response,
        )
        with patch("pipeline.imf._load_cached", return_value=None), \
             patch("pipeline.imf._save_cached"), \
             patch("pipeline.imf.save_data"):
            df = fetch_imf(
                indicators={"NGDPDPC": "GDP per capita"},
                start_year=2000,
                end_year=2023,
                save=False,
            )

        assert df is not None
        assert all(int(y) <= 2023 for y in df["year"])

    def test_projection_years_saved_separately(self, requests_mock):
        """With projection_end_year set: actuals returned, projections saved apart."""
        resp = {
            "values": {
                "NGDPDPC": {
                    "KEN": {"2022": 2082.0, "2023": 2200.0,  # actuals
                            "2026": 2600.0, "2030": 3100.0}   # projections
                }
            }
        }
        requests_mock.get(
            "https://www.imf.org/external/datamapper/api/v1/NGDPDPC",
            json=resp,
        )
        saved: dict[str, object] = {}

        def _capture(df, name, _dir):
            saved[name] = df.copy()

        with patch("pipeline.imf._load_cached", return_value=None), \
             patch("pipeline.imf._save_cached"), \
             patch("pipeline.imf.save_data", side_effect=_capture):
            df = fetch_imf(
                indicators={"NGDPDPC": "GDP per capita"},
                start_year=2000,
                end_year=2023,
                projection_end_year=2030,
                save=True,
            )

        # Returned frame is actuals-only.
        assert df is not None
        assert all(int(y) <= 2023 for y in df["year"])
        assert set(df["source"].unique()) == {"IMF"}

        # Two files written: imf (actuals) and imf_projections (forward years).
        assert "imf" in saved and "imf_projections" in saved
        proj = saved["imf_projections"]
        assert all(int(y) > 2023 for y in proj["year"])
        assert set(proj["source"].unique()) == {"IMF WEO (projection)"}
        assert set(int(y) for y in proj["year"]) == {2026, 2030}

    def test_no_projection_file_when_disabled(self, requests_mock):
        """Default behaviour (no projection_end_year) writes only imf.parquet."""
        resp = {"values": {"NGDPDPC": {"KEN": {"2022": 2082.0, "2030": 3100.0}}}}
        requests_mock.get(
            "https://www.imf.org/external/datamapper/api/v1/NGDPDPC",
            json=resp,
        )
        saved: list[str] = []

        with patch("pipeline.imf._load_cached", return_value=None), \
             patch("pipeline.imf._save_cached"), \
             patch("pipeline.imf.save_data", side_effect=lambda df, name, d: saved.append(name)):
            fetch_imf(
                indicators={"NGDPDPC": "GDP per capita"},
                start_year=2000,
                end_year=2023,
                save=True,
            )

        assert saved == ["imf"]  # no imf_projections

    def test_logs_skip_on_404(self, requests_mock):
        requests_mock.get(
            "https://www.imf.org/external/datamapper/api/v1/MISSING",
            status_code=404,
        )
        with patch("pipeline.imf._load_cached", return_value=None), \
             patch("pipeline.imf.log_skip") as mock_log:
            fetch_imf(
                indicators={"MISSING": "Missing indicator"},
                save=False,
            )

        mock_log.assert_called_once()
        assert mock_log.call_args[0][3] in ("http_404", "api_error")

    def test_cache_hit_skips_http(self, requests_mock):
        """No HTTP request should be made when cache is warm."""
        from pipeline.utils import make_standard_df
        from tests.conftest import make_record
        cached = make_standard_df([make_record(indicator_code="NGDPDPC", source="IMF")])

        with patch("pipeline.imf._load_cached", return_value=cached), \
             patch("pipeline.imf.save_data"):
            fetch_imf(
                indicators={"NGDPDPC": "GDP per capita"},
                save=False,
            )

        assert requests_mock.call_count == 0
