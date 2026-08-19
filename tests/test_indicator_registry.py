"""
test_indicator_registry.py — Unit tests for pipeline/indicator_registry.py.

Covers: construction invariants, pillar overlap, master reconciliation,
        and the TypeScript export.
"""

from __future__ import annotations

import json

import pytest

from pipeline.indicator_registry import (
    PILLARS,
    REGISTRY,
    Indicator,
    all_codes,
    by_pillar,
    export_typescript,
    get,
    unavailable,
    validate_against_master,
)


class TestInvariants:
    def test_every_domain_is_a_known_pillar(self):
        for ind in REGISTRY.values():
            assert ind.domain in PILLARS

    def test_every_pillar_tag_is_known(self):
        for ind in REGISTRY.values():
            assert set(ind.pillars).issubset(PILLARS)

    def test_domain_is_always_in_its_pillar_set(self):
        for ind in REGISTRY.values():
            assert ind.domain in ind.pillars

    def test_codes_are_unique(self):
        assert len(REGISTRY) == len({i.code for i in REGISTRY.values()})

    def test_construction_rejects_unknown_domain(self):
        with pytest.raises(ValueError):
            Indicator(code="X", label="x", domain="nonsense", source="s",
                      unit="%", direction=1, interpretation="")

    def test_construction_rejects_bad_direction(self):
        with pytest.raises(ValueError):
            Indicator(code="X", label="x", domain="macro", source="s",
                      unit="%", direction=7, interpretation="")


class TestAccessors:
    def test_by_pillar_includes_shared_indicators(self):
        # GC.REV.XGRT.GD.ZS is primary 'revenue' but also tagged macro + debt.
        rev = get("GC.REV.XGRT.GD.ZS")
        assert rev is not None
        assert "revenue" in rev.pillars
        assert "debt" in rev.pillars
        # It should therefore surface on all three pillar pages.
        assert rev in by_pillar("revenue")
        assert rev in by_pillar("debt")
        assert rev in by_pillar("macro")

    def test_by_pillar_rejects_unknown(self):
        with pytest.raises(ValueError):
            by_pillar("not_a_pillar")

    def test_all_codes_available_only_excludes_gaps(self):
        every = set(all_codes())
        avail = set(all_codes(available_only=True))
        gaps = {i.code for i in unavailable()}
        assert gaps
        assert gaps.isdisjoint(avail)
        assert gaps.issubset(every)


class TestMasterReconciliation:
    def test_no_drift_when_all_available_present(self):
        master_codes = set(all_codes(available_only=True))
        res = validate_against_master(master_codes)
        assert res["missing_but_available"] == []

    def test_flags_available_code_absent_from_master(self):
        # Pretend master has nothing.
        res = validate_against_master(set())
        assert "GHED_gghed_gge" in res["missing_but_available"]

    def test_flags_unavailable_code_that_appears(self):
        gap = unavailable()[0].code
        res = validate_against_master({gap})
        assert gap in res["present_but_unavailable"]


class TestTypeScriptExport:
    def test_export_writes_valid_structure(self, tmp_path):
        dest = tmp_path / "indicator-registry.ts"
        export_typescript(dest)
        text = dest.read_text()
        assert "INDICATOR_REGISTRY" in text
        assert "export const PILLARS" in text
        # The JSON payload should round-trip for every registered code.
        start = text.index("{", text.index("INDICATOR_REGISTRY"))
        end = text.rindex("}") + 1
        parsed = json.loads(text[start:end])
        assert set(parsed.keys()) == set(REGISTRY.keys())
        assert parsed["GHED_gghed_gge"]["benchmarks"]["Abuja"] == 15.0
