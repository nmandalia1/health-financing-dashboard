"""
conftest.py — Shared pytest fixtures for the Health Financing Dashboard pipeline tests.
"""

from __future__ import annotations

import pandas as pd
import pytest

from pipeline.utils import STANDARD_COLUMNS


# ── Minimal valid record factory ──────────────────────────────────────────────

def make_record(**overrides) -> dict:
    """Return a minimal valid indicator record, with optional field overrides."""
    base = {
        "iso3":           "KEN",
        "country_name":   "Kenya",
        "year":           2020,
        "indicator_code": "TEST_001",
        "indicator_name": "Test Indicator",
        "value":          42.0,
        "source":         "Test Source",
        "pulled_at":      "2024-01-01 00:00 UTC",
    }
    base.update(overrides)
    return base


@pytest.fixture
def sample_records() -> list[dict]:
    """A small set of valid records covering 3 countries and 2 indicators."""
    return [
        make_record(iso3="KEN", year=2020, indicator_code="IND_A", value=10.0),
        make_record(iso3="KEN", year=2021, indicator_code="IND_A", value=11.0),
        make_record(iso3="NGA", year=2020, indicator_code="IND_A", value=20.0),
        make_record(iso3="ZAF", year=2020, indicator_code="IND_A", value=30.0),
        make_record(iso3="KEN", year=2020, indicator_code="IND_B", value=5.0),
        make_record(iso3="NGA", year=2020, indicator_code="IND_B", value=6.0),
    ]


@pytest.fixture
def sample_df(sample_records) -> pd.DataFrame:
    """Standard-format DataFrame built from sample_records."""
    from pipeline.utils import make_standard_df
    return make_standard_df(sample_records)


@pytest.fixture
def master_parquet_df(tmp_path) -> pd.DataFrame:
    """
    A minimal master-style DataFrame saved to a tmp Parquet file.
    Use for testing load/save utilities without touching real data.
    """
    from pipeline.utils import make_standard_df
    records = [
        make_record(iso3="KEN", year=y, indicator_code="IND_A", source="World Bank")
        for y in range(2000, 2024)
    ] + [
        make_record(iso3="NGA", year=y, indicator_code="IND_B", source="WHO GHO")
        for y in range(2000, 2024)
    ]
    df = make_standard_df(records)
    path = tmp_path / "master.parquet"
    df.to_parquet(path, index=False)
    return df


@pytest.fixture
def gho_page_response() -> dict:
    """Simulated single-page GHO API response with 3 country rows."""
    return {
        "value": [
            {"SpatialDim": "KEN", "TimeDim": 2020, "NumericValue": 5.1,
             "Value": "5.1", "Dim1": "BTSX", "Dim2": None},
            {"SpatialDim": "NGA", "TimeDim": 2020, "NumericValue": 3.8,
             "Value": "3.8", "Dim1": None,   "Dim2": None},
            {"SpatialDim": "ZAF", "TimeDim": 2021, "NumericValue": 8.2,
             "Value": "8.2", "Dim1": "BTSX", "Dim2": None},
        ]
    }


@pytest.fixture
def gho_paginated_responses() -> list[dict]:
    """
    Simulated two-page GHO response.

    GHO caps a response at 1000 rows and emits NO @odata.nextLink, so the
    fetcher pages with $skip. A full page means "there may be more"; a short
    page terminates the loop.
    """
    page1_values = [
        {"SpatialDim": f"C{i:02d}", "TimeDim": 2020, "NumericValue": float(i),
         "Value": str(i), "Dim1": "BTSX", "Dim2": None}
        for i in range(1000)
    ]
    page2_values = [
        {"SpatialDim": "KEN", "TimeDim": 2020, "NumericValue": 42.0,
         "Value": "42.0", "Dim1": "BTSX", "Dim2": None}
    ]
    return [{"value": page1_values}, {"value": page2_values}]
