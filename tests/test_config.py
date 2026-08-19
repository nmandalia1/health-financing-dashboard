"""
test_config.py — Validate the indicator configuration.

These tests catch the class of bugs that hit us in production:
  - Stale / non-existent indicator codes
  - Duplicate codes across sources
  - Empty strings in code or name fields
"""

from __future__ import annotations

import pytest

from pipeline.config import (
    END_YEAR,
    IMF_INDICATORS,
    START_YEAR,
    WHO_GHO_INDICATORS,
    WHO_IMMUNIZATION_INDICATORS,
    WORLD_BANK_INDICATORS,
)


class TestWorldBankIndicators:
    def test_no_empty_codes(self):
        for code in WORLD_BANK_INDICATORS:
            assert code and code.strip(), f"Empty code in WORLD_BANK_INDICATORS"

    def test_no_empty_names(self):
        for code, name in WORLD_BANK_INDICATORS.items():
            assert name and name.strip(), f"Empty name for WB code: {code!r}"

    def test_codes_are_strings(self):
        for code in WORLD_BANK_INDICATORS:
            assert isinstance(code, str), f"Non-string code: {code!r}"

    def test_no_duplicate_codes(self):
        codes = list(WORLD_BANK_INDICATORS.keys())
        assert len(codes) == len(set(codes)), "Duplicate codes in WORLD_BANK_INDICATORS"


class TestWHOGHOIndicators:
    def test_no_empty_codes(self):
        for code in WHO_GHO_INDICATORS:
            assert code and code.strip(), "Empty code in WHO_GHO_INDICATORS"

    def test_no_empty_names(self):
        for code, name in WHO_GHO_INDICATORS.items():
            assert name and name.strip(), f"Empty name for GHO code: {code!r}"

    def test_no_duplicate_codes(self):
        codes = list(WHO_GHO_INDICATORS.keys())
        assert len(codes) == len(set(codes)), "Duplicate codes in WHO_GHO_INDICATORS"


class TestIMFIndicators:
    def test_no_empty_codes(self):
        for code in IMF_INDICATORS:
            assert code and code.strip(), "Empty code in IMF_INDICATORS"

    def test_no_empty_names(self):
        for code, name in IMF_INDICATORS.items():
            assert name and name.strip(), f"Empty name for IMF code: {code!r}"

    def test_no_duplicate_codes(self):
        codes = list(IMF_INDICATORS.keys())
        assert len(codes) == len(set(codes)), "Duplicate codes in IMF_INDICATORS"


class TestWHOImmunizationIndicators:
    def test_no_empty_codes(self):
        for code in WHO_IMMUNIZATION_INDICATORS:
            assert code and code.strip(), "Empty code in WHO_IMMUNIZATION_INDICATORS"

    def test_no_empty_names(self):
        for code, name in WHO_IMMUNIZATION_INDICATORS.items():
            assert name and name.strip(), f"Empty name for immunization code: {code!r}"

    def test_exactly_three_indicators(self):
        """Exactly the three JRF time-series indicators should be configured."""
        assert len(WHO_IMMUNIZATION_INDICATORS) == 3
        assert "WHO_IMM_GOV_VAX_USD" in WHO_IMMUNIZATION_INDICATORS
        assert "WHO_IMM_TOT_VAX_USD" in WHO_IMMUNIZATION_INDICATORS
        assert "WHO_IMM_GOV_SHARE"   in WHO_IMMUNIZATION_INDICATORS


class TestCrossSourceUniqueness:
    def test_no_duplicate_codes_across_sources(self):
        """
        Codes must be globally unique — a duplicate across sources would
        cause rows to be wrongly merged in the master dataset.
        """
        wb_codes  = set(WORLD_BANK_INDICATORS.keys())
        gho_codes = set(WHO_GHO_INDICATORS.keys())
        imf_codes = set(IMF_INDICATORS.keys())
        imm_codes = set(WHO_IMMUNIZATION_INDICATORS.keys())

        all_pairs = [
            ("WB",  "GHO", wb_codes  & gho_codes),
            ("WB",  "IMF", wb_codes  & imf_codes),
            ("WB",  "IMM", wb_codes  & imm_codes),
            ("GHO", "IMF", gho_codes & imf_codes),
            ("GHO", "IMM", gho_codes & imm_codes),
            ("IMF", "IMM", imf_codes & imm_codes),
        ]
        for src_a, src_b, overlap in all_pairs:
            assert not overlap, f"Codes in both {src_a} and {src_b}: {overlap}"


class TestYearRange:
    def test_start_before_end(self):
        assert START_YEAR < END_YEAR

    def test_reasonable_range(self):
        assert START_YEAR >= 1990
        assert END_YEAR   <= 2030
