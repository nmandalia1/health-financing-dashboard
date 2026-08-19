"""
indicator_registry.py — Single source of truth for fiscal-space indicator metadata.

The pipeline's `config.py` answers "what do we pull and what is it called?".
This registry answers the *semantic* questions the redesign needs and that were
previously hardcoded inline in the dashboard's tooltips:

  - which fiscal-space pillar(s) does an indicator belong to (drives the
    "also appears in …" tags when an indicator is shared across pillar pages),
  - which direction is "good" (drives normalisation for composite sub-indices),
  - what benchmark(s) apply (Abuja 15%, the 5%-of-GDP UHC guide, …),
  - how to normalise it into a 0–100 pillar score,
  - the prose used in tooltips and methodology pages.

It is deliberately decoupled from how the data is *fetched*: an entry's `code`
is the `indicator_code` as it appears in `master.parquet`, regardless of which
downloader produced it.

`available=False` marks indicators we *want* but cannot currently source — see
the data-pull adequacy evaluation. They are kept here (with a `fallback_code`
where one exists) so the data-readiness report can surface them as gaps rather
than silently omitting them.

Mirror to TypeScript with `export_typescript()` so the dashboard reads the same
metadata the pipeline does.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

# ── Pillars ────────────────────────────────────────────────────────────────
# The seven fiscal-space-for-health pillars. Order is the canonical display
# order on the index page and in the pillar navigation.
PILLARS: dict[str, str] = {
    "macro":          "Macroeconomic & fiscal envelope",
    "revenue":        "Domestic revenue mobilisation",
    "prioritisation": "Health reprioritisation",
    "external":       "External financing & aid transition",
    "debt":           "Debt sustainability & crowding-out",
    "efficiency":     "Efficiency of spending",
    "pfm":            "PFM, governance & absorptive capacity",
}

# Direction semantics for normalisation.
HIGHER_BETTER = 1
LOWER_BETTER = -1
NEUTRAL = 0


@dataclass(frozen=True)
class Indicator:
    """Metadata for one indicator. `code` matches master.parquet.indicator_code."""

    code: str
    label: str
    domain: str                       # primary pillar key (must be in PILLARS)
    source: str
    unit: str
    direction: int                    # HIGHER_BETTER / LOWER_BETTER / NEUTRAL
    interpretation: str
    pillars: tuple[str, ...] = ()     # display pillars (overlap); index scores by `domain` only
    benchmarks: dict[str, float] = field(default_factory=dict)
    # Index behaviour today keys off two cases only: "none" = excluded from
    # scoring (context / absolute-US$ / outcome indicators), anything else =
    # included via winsorised peer min-max. The finer labels (fixed_minmax,
    # zscore) are reserved for a future per-indicator normalisation refinement
    # and are NOT yet applied differently.
    normalization: str = "peer_minmax"  # peer_minmax | fixed_minmax | zscore | none
    reference_url: str = ""
    available: bool = True            # False = wanted but not currently sourced
    fallback_code: str | None = None  # alternative code when primary is unavailable

    def __post_init__(self) -> None:
        if self.domain not in PILLARS:
            raise ValueError(f"{self.code}: unknown domain {self.domain!r}")
        bad = set(self.pillars) - set(PILLARS)
        if bad:
            raise ValueError(f"{self.code}: unknown pillar(s) {bad}")
        if self.direction not in (HIGHER_BETTER, LOWER_BETTER, NEUTRAL):
            raise ValueError(f"{self.code}: invalid direction {self.direction}")


def _ind(code: str, label: str, domain: str, source: str, unit: str,
         direction: int, interpretation: str, *,
         also: tuple[str, ...] = (), benchmarks: dict[str, float] | None = None,
         normalization: str = "peer_minmax", url: str = "",
         available: bool = True, fallback: str | None = None) -> Indicator:
    """Concise constructor. `domain` is auto-added to the pillar set."""
    pillars = tuple(dict.fromkeys((domain, *also)))  # de-dupe, keep order
    return Indicator(
        code=code, label=label, domain=domain, source=source, unit=unit,
        direction=direction, interpretation=interpretation, pillars=pillars,
        benchmarks=benchmarks or {}, normalization=normalization,
        reference_url=url, available=available, fallback_code=fallback,
    )


# ── The registry ───────────────────────────────────────────────────────────
_REGISTRY: list[Indicator] = [
    # ----- Pillar 1 · Macroeconomic & fiscal envelope -----------------------
    _ind("NGDP_RPCH", "Real GDP growth", "macro", "IMF WEO", "%", HIGHER_BETTER,
         "Sustained real GDP growth can expand the public resource envelope, making health budget increases "
         "easier to finance. The 2% line is a heuristic, not a formal standard.",
         benchmarks={"heuristic_floor": 2.0},
         url="https://www.imf.org/en/Publications/WEO"),
    _ind("NGDPDPC", "GDP per capita (current US$)", "macro", "IMF WEO", "US$", HIGHER_BETTER,
         "Context / peer-grouping variable only — income LEVEL is not scored into the fiscal-space index "
         "(the macro pillar captures growth & price stability, per Tandon-Cashin; level would triple-count "
         "with the PPP and World Bank series and proxy everything).",
         normalization="none"),
    _ind("PPPPC", "GDP per capita, PPP", "macro", "IMF WEO", "intl$", HIGHER_BETTER,
         "Context / peer-grouping variable only (see GDP per capita). Not scored into the index.",
         normalization="none"),
    _ind("PCPIPCH", "Inflation (consumer prices)", "macro", "IMF WEO", "%", LOWER_BETTER,
         "High or volatile inflation reduces the purchasing power of health budgets and households. "
         "The 10% line is a warning reference, not a hard threshold.",
         also=("efficiency",), benchmarks={"heuristic_caution": 10.0}),
    _ind("NY.GDP.PCAP.CD", "GDP per capita (WB, current US$)", "macro", "World Bank", "US$", HIGHER_BETTER,
         "Context / peer-grouping variable only — basis for World Bank income grouping. Not scored into the index.",
         normalization="none"),

    # ----- Pillar 2 · Domestic revenue mobilisation -------------------------
    _ind("GC.REV.XGRT.GD.ZS", "Government revenue (excl. grants)", "revenue", "World Bank", "% GDP",
         HIGHER_BETTER,
         "Total domestic public revenue excluding grants — the size of the public resource envelope before "
         "allocation decisions. The ~15%-of-GDP reference point applies to tax revenue specifically, so "
         "compare carefully against this broader measure.",
         also=("macro", "debt"),
         url="https://data.worldbank.org/indicator/GC.REV.XGRT.GD.ZS"),
    _ind("GC.TAX.TOTL.GD.ZS", "Tax revenue", "revenue", "World Bank", "% GDP", HIGHER_BETTER,
         "Tax revenue is the most policy-actionable part of the public resource envelope. About 15% of GDP "
         "is often cited as a minimum reference for state capacity.",
         benchmarks={"tax_capacity_tipping_point": 15.0}),
    _ind("GGR_NGDP", "Government revenue (IMF)", "revenue", "IMF WEO", "% GDP", HIGHER_BETTER,
         "IMF general-government revenue. Currently empty from the DataMapper API — falls back to the World Bank series.",
         also=("macro",), available=False, fallback="GC.REV.XGRT.GD.ZS"),

    # ----- Pillar 3 · Health reprioritisation -------------------------------
    _ind("GHED_gghed_gge", "Government health spending (% of govt budget)", "prioritisation", "WHO GHED",
         "% GGE", HIGHER_BETTER,
         "Shows the share of government spending allocated to health. The Abuja Declaration set a 15% target "
         "for African Union members.",
         benchmarks={"Abuja": 15.0}, url="https://apps.who.int/nha/database"),
    _ind("GHED_gghed_gdp", "Government health spending (% of GDP)", "prioritisation", "WHO GHED",
         "% GDP", HIGHER_BETTER,
         "Shows public health spending relative to the whole economy, combining the size of the public "
         "budget and the priority given to health. Around 5% of GDP from public sources is often used as a "
         "reference for progress toward UHC, but it is not a binding global standard.",
         also=("efficiency",), benchmarks={"UHC_progress_guide_5pct": 5.0}),
    _ind("GHED_gghed_pc_usd", "Government health spending per capita", "prioritisation", "WHO GHED",
         "US$", HIGHER_BETTER,
         "Absolute public resourcing per person — most directly comparable to a costed benefit package. "
         "Reference US$86 is the Chatham House essential-package estimate in 2012 prices "
         "(McIntyre & Meheus 2014); later costings differ (e.g. Stenberg et al. 2017 ≈US$112 by 2030), "
         "so treat as an order-of-magnitude anchor.",
         benchmarks={"essential_package_2012usd": 86.0}),
    _ind("GHED_gge_gdp", "Government expenditure (% of GDP)", "prioritisation", "WHO GHED",
         "% GDP", NEUTRAL,
         "Size of the total budget envelope within which health competes for share.",
         also=("macro",)),

    # ----- Pillar 4 · External financing & aid transition -------------------
    _ind("GHED_ext_che", "External health spending (% of CHE)", "external", "WHO GHED", "% CHE",
         LOWER_BETTER,
         "Shows how much current health expenditure is funded by external sources. High shares can create "
         "transition risk if aid declines. The ~20% watch line is a heuristic from the transition "
         "literature (Gavi/Global Fund eligibility & co-financing), not a formal global standard.",
         benchmarks={"heuristic_transition_watch": 20.0}, url="https://apps.who.int/nha/database"),
    _ind("SH.XPD.EHEX.CH.ZS", "External health expenditure (% of CHE, WB)", "external", "World Bank",
         "% CHE", LOWER_BETTER,
         "World Bank cross-check on donor dependency."),
    _ind("DT.ODA.ALLD.CD", "Net ODA received", "external", "World Bank", "US$", NEUTRAL,
         "Context only — absolute ODA in US$ is not comparable across economies of different size and is "
         "directionally ambiguous (more aid ≠ more or less fiscal space), so it is not scored into the index.",
         normalization="none"),

    # ----- Pillar 5 · Debt sustainability & crowding-out --------------------
    _ind("GGXWDG_NGDP", "Government gross debt", "debt", "IMF WEO", "% GDP", LOWER_BETTER,
         "Debt thresholds vary by country context and debt-carrying capacity. Rising debt can reduce future "
         "health fiscal space through higher debt service. The reference lines (~60% of GDP, EU/IMF "
         "emerging-market scrutiny; ~55%, IMF–World Bank LIC framework for medium capacity) are heuristics, "
         "not hard thresholds.",
         benchmarks={"EU_EM_line": 60.0, "LIC_DSF_medium_capacity": 55.0},
         url="https://www.imf.org/external/datamapper/datasets/WEO"),
    _ind("GGXCNL_NGDP", "Fiscal balance (surplus or deficit)", "debt", "IMF WEO", "% GDP",
         HIGHER_BETTER,
         "Persistent large deficits can raise debt-service pressures. The -3%-of-GDP line is a fiscal-rule "
         "reference point (EU Stability & Growth Pact), not a universal danger threshold.",
         also=("macro",), benchmarks={"EU_fiscal_rule": -3.0}),
    _ind("DT.TDS.DECT.GN.ZS", "External debt service", "debt", "World Bank", "% GNI", LOWER_BETTER,
         "External debt service can crowd out public spending, including health. This measure excludes "
         "domestic debt service."),
    _ind("DT.DOD.DECT.CD", "External debt stock", "debt", "World Bank", "US$", LOWER_BETTER,
         "Context only — absolute external obligations in US$ are not comparable across economies of "
         "different size; the %-of-GDP debt measures carry the scoring.",
         normalization="none"),
    _ind("GC.DOD.TOTL.GD.ZS", "Central government debt", "debt", "World Bank", "% GDP", LOWER_BETTER,
         "Domestic + external central-government debt as a share of GDP."),
    _ind("GGXONLB_NGDP", "Primary balance", "debt", "IMF WEO", "% GDP", HIGHER_BETTER,
         "Balance excluding interest — the lever a government actually controls. Currently empty from DataMapper.",
         available=False),

    # ----- Pillar 6 · Efficiency of spending --------------------------------
    # Outcome indicators: NOT averaged into a pillar score; they feed the
    # efficiency proxy (attainment vs spending). normalization="none".
    _ind("SH.DYN.MORT", "Under-5 mortality", "efficiency", "World Bank", "per 1,000", LOWER_BETTER,
         "Outcome feeding the spending-efficiency proxy (attainment relative to spend); also shown raw.",
         normalization="none"),
    _ind("SH.STA.MMRT", "Maternal mortality ratio", "efficiency", "World Bank", "per 100,000",
         LOWER_BETTER,
         "Outcome feeding the spending-efficiency proxy; high-sensitivity measure of system effectiveness.",
         normalization="none"),
    _ind("SP.DYN.LE00.IN", "Life expectancy at birth", "efficiency", "World Bank", "years",
         HIGHER_BETTER,
         "Summary outcome feeding the spending-efficiency proxy.",
         normalization="none"),
    _ind("UHC_INDEX_REPORTED", "UHC Service Coverage Index", "efficiency", "WHO GHO", "0–100",
         HIGHER_BETTER,
         "Service-coverage attainment feeding the spending-efficiency proxy. SDG 3.8.1 targets coverage for "
         "all by 2030; the ~80 line is WHO's interim 'high coverage' marker (GPW13 / UHC monitoring), not "
         "the SDG target value itself.",
         benchmarks={"WHO_interim_high_coverage": 80.0},
         normalization="none", fallback="SH.UHC.SRVS.CV.XD"),

    # ----- Pillar 7 · PFM, governance & absorptive capacity -----------------
    _ind("PEFA16_OVERALL_AVG", "PEFA overall score", "pfm", "PEFA 2016", "1–4", HIGHER_BETTER,
         "Overall public financial management quality — can the budget be executed as planned?",
         normalization="fixed_minmax", url="https://www.pefa.org"),
    _ind("PEFA16_BUDGET_RELIAB_AVG", "PEFA budget reliability", "pfm", "PEFA 2016", "1–4",
         HIGHER_BETTER,
         "Do actuals match the approved budget? Weak reliability means appropriated health money may not arrive.",
         normalization="fixed_minmax"),
    _ind("PEFA16_PILLAR3_AVG", "PEFA budget execution", "pfm", "PEFA 2016", "1–4",
         HIGHER_BETTER,
         "Shows whether public funds can be released, controlled, and spent as planned.",
         also=("efficiency",), normalization="fixed_minmax"),
    _ind("IQ.CPA.FINQ.XQ", "CPIA financial management quality", "pfm", "CPIA", "1–6", HIGHER_BETTER,
         "World Bank assessment of budgetary and financial management quality (IDA countries).",
         normalization="fixed_minmax"),
    _ind("IQ.CPA.IRAI.XQ", "CPIA policy & institutions (overall)", "pfm", "CPIA", "1–6", HIGHER_BETTER,
         "Overall institutional and policy quality — conditioning variable for whether spend converts to outcomes."),
    _ind("GOV_WGI_GE.EST", "Government effectiveness (WGI)", "pfm", "WGI", "z-score", HIGHER_BETTER,
         "Strong implementation capacity helps public health spending translate into services.",
         normalization="zscore", benchmarks={"midpoint": 0.0}),
    _ind("GOV_WGI_CC.EST", "Control of corruption (WGI)", "pfm", "WGI", "z-score", HIGHER_BETTER,
         "Weak control of corruption increases the risk that public resources do not reach intended services.",
         normalization="zscore"),
    _ind("GOV_WGI_RL.EST", "Rule of law (WGI)", "pfm", "WGI", "z-score", HIGHER_BETTER,
         "Institutional reliability underpinning predictable budget execution.",
         normalization="zscore"),
    _ind("WB_FCV_STATUS", "Fragile/conflict status", "pfm", "World Bank FCV", "0/1", LOWER_BETTER,
         "FCV settings face structurally constrained fiscal space and execution capacity.",
         normalization="none"),
]

# Index for O(1) lookup; also enforces unique codes.
REGISTRY: dict[str, Indicator] = {}
for _i in _REGISTRY:
    if _i.code in REGISTRY:
        raise ValueError(f"Duplicate registry code: {_i.code}")
    REGISTRY[_i.code] = _i


# ── Accessors ──────────────────────────────────────────────────────────────

def get(code: str) -> Indicator | None:
    """Return the Indicator for a code, or None if not registered."""
    return REGISTRY.get(code)


def all_codes(available_only: bool = False) -> list[str]:
    """All registered codes, optionally only those currently sourceable."""
    return [c for c, i in REGISTRY.items() if i.available or not available_only]


def by_pillar(pillar: str) -> list[Indicator]:
    """Every indicator that appears on a pillar page (honours overlap)."""
    if pillar not in PILLARS:
        raise ValueError(f"Unknown pillar: {pillar}")
    return [i for i in REGISTRY.values() if pillar in i.pillars]


def unavailable() -> list[Indicator]:
    """Indicators we want but cannot currently source (data-pull gaps)."""
    return [i for i in REGISTRY.values() if not i.available]


def validate_against_master(master_codes: set[str]) -> dict[str, list[str]]:
    """
    Cross-check the registry against the codes actually present in master.

    Returns:
      {
        "missing_but_available": [...],  # marked available but absent in master
        "present_but_unavailable": [...] # marked unavailable but actually present
      }
    Both lists should ideally be empty; non-empty means registry ↔ data drift.
    """
    missing_but_available = sorted(
        c for c, i in REGISTRY.items() if i.available and c not in master_codes
    )
    present_but_unavailable = sorted(
        c for c, i in REGISTRY.items() if not i.available and c in master_codes
    )
    return {
        "missing_but_available": missing_but_available,
        "present_but_unavailable": present_but_unavailable,
    }


# ── TypeScript export ──────────────────────────────────────────────────────

def export_typescript(dest: str | Path) -> Path:
    """
    Write the registry to a TypeScript module the dashboard can import, so the
    UI and the pipeline share one definition of pillars, directions, benchmarks
    and prose. Regenerate whenever the registry changes.
    """
    dest = Path(dest)
    entries = {c: asdict(i) for c, i in REGISTRY.items()}
    header = (
        "// AUTO-GENERATED by pipeline/indicator_registry.py — do not edit by hand.\n"
        "// Regenerate with: python -m pipeline.indicator_registry --export-ts\n\n"
        "export interface Indicator {\n"
        "  code: string;\n  label: string;\n  domain: string;\n  source: string;\n"
        "  unit: string;\n  direction: number;\n  interpretation: string;\n"
        "  pillars: string[];\n  benchmarks: Record<string, number>;\n"
        "  normalization: string;\n  reference_url: string;\n"
        "  available: boolean;\n  fallback_code: string | null;\n}\n\n"
    )
    pillars_ts = "export const PILLARS = " + json.dumps(PILLARS, indent=2) + " as const;\n\n"
    registry_ts = (
        "export const INDICATOR_REGISTRY: Record<string, Indicator> = "
        + json.dumps(entries, indent=2)
        + ";\n"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(header + pillars_ts + registry_ts, encoding="utf-8")
    return dest


if __name__ == "__main__":
    import sys

    if "--export-ts" in sys.argv:
        out = export_typescript(
            Path(__file__).resolve().parents[1]
            / "dashboard" / "src" / "lib" / "indicator-registry.ts"
        )
        print(f"Wrote {out}")
    else:
        print(f"{len(REGISTRY)} indicators across {len(PILLARS)} pillars")
        for key, label in PILLARS.items():
            print(f"  {key:14s} {label:40s} {len(by_pillar(key))} indicators")
        gaps = unavailable()
        if gaps:
            print(f"\n  {len(gaps)} unavailable (data-pull gaps): "
                  + ", ".join(i.code for i in gaps))
