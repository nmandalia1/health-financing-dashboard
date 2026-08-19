"""
test_data_readiness.py — Unit tests for pipeline/data_readiness.py.

Builds a synthetic master with known coverage and asserts the report's
coverage maths, status tags, and gap detection.
"""

from __future__ import annotations

import pandas as pd

from pipeline.data_readiness import (
    build_readiness_report,
    compute_coverage,
)
from pipeline.indicator_registry import unavailable


def _synthetic_master() -> pd.DataFrame:
    """A present 'available' indicator over 3 countries/2 years, plus noise."""
    rows = [
        # GHED_gghed_gge present for KEN, NGA, ZAF
        ("KEN", 2022, "GHED_gghed_gge", 8.0),
        ("KEN", 2023, "GHED_gghed_gge", 8.4),
        ("NGA", 2023, "GHED_gghed_gge", 5.0),
        ("ZAF", 2023, "GHED_gghed_gge", 14.0),
        # an unrelated code that isn't in the registry
        ("KEN", 2023, "SOME_OTHER_CODE", 1.0),
    ]
    return pd.DataFrame(
        [
            {
                "iso3": iso3, "country_name": iso3, "year": y,
                "indicator_code": code, "indicator_name": code,
                "value": v, "source": "Test", "pulled_at": "2024",
            }
            for iso3, y, code, v in rows
        ]
    )


class TestComputeCoverage:
    def test_counts_countries_latest_and_obs(self):
        master = _synthetic_master()
        covs = {c.code: c for c in compute_coverage(master)}
        gge = covs["GHED_gghed_gge"]
        assert gge.present
        assert gge.n_countries == 3
        assert gge.latest_year == 2023
        assert gge.n_obs == 4

    def test_absent_registry_code_marked_not_present(self):
        master = _synthetic_master()
        covs = {c.code: c for c in compute_coverage(master)}
        # GGXWDG_NGDP is registered but not in the synthetic master.
        assert covs["GGXWDG_NGDP"].present is False
        assert covs["GGXWDG_NGDP"].n_countries == 0


class TestBuildReport:
    def test_report_has_expected_sections(self, tmp_path):
        master_path = tmp_path / "master.parquet"
        _synthetic_master().to_parquet(master_path, index=False)
        out = tmp_path / "readiness.md"

        report = build_readiness_report(master_path=master_path, out_path=out)

        assert out.exists()
        for heading in ("# Data Readiness Report", "## Summary by pillar",
                        "## Detail", "## Data-pull gaps", "## Registry ↔ master drift"):
            assert heading in report

    def test_unavailable_indicator_shows_in_gaps(self, tmp_path):
        master_path = tmp_path / "master.parquet"
        _synthetic_master().to_parquet(master_path, index=False)
        out = tmp_path / "readiness.md"

        report = build_readiness_report(master_path=master_path, out_path=out)

        gap_code = unavailable()[0].code
        gaps_section = report.split("## Data-pull gaps")[1]
        assert gap_code in gaps_section

    def test_present_available_indicator_is_ok(self, tmp_path):
        master_path = tmp_path / "master.parquet"
        _synthetic_master().to_parquet(master_path, index=False)
        out = tmp_path / "readiness.md"

        report = build_readiness_report(master_path=master_path, out_path=out)
        # GHED_gghed_gge has 3 countries — above the low-coverage floor for a
        # 3-country master — so it should read OK in the detail table.
        gge_line = next(
            ln for ln in report.splitlines() if "`GHED_gghed_gge`" in ln
        )
        assert "OK" in gge_line
