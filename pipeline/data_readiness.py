"""
data_readiness.py — Generate a per-pillar, per-indicator coverage audit.

Turns "are the data pull systems adequate?" into a checkable artifact instead
of a manual audit. Reads the registered fiscal-space indicators
(`indicator_registry`) and the consolidated `master.parquet`, then reports, for
each indicator: whether it is present, how many countries it covers, its latest
year, and observation count — rolled up by pillar.

It also surfaces two failure modes explicitly:
  - data-pull gaps: indicators the registry wants but that are absent or
    marked unavailable (with their fallback, if any);
  - registry ↔ master drift: codes whose availability flag disagrees with what
    is actually in master.

Run standalone (`python -m pipeline.data_readiness`) or call
`build_readiness_report()` from the pipeline after the master is built.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .config import LOGS_DIR, PROCESSED_DIR
from .indicator_registry import (
    PILLARS,
    REGISTRY,
    by_pillar,
    get,
    validate_against_master,
)
from .utils import now_utc

# A coverage figure below this share of the countries seen in master is flagged.
LOW_COVERAGE_FRACTION = 0.30


@dataclass
class IndicatorCoverage:
    code: str
    present: bool
    n_countries: int
    latest_year: int | None
    n_obs: int
    available: bool          # registry intent
    fallback_code: str | None


def _coverage_for_code(code: str, master: pd.DataFrame) -> tuple[int, int | None, int]:
    """Return (n_countries, latest_year, n_obs) for one indicator code in master."""
    sub = master[(master["indicator_code"] == code) & master["value"].notna()]
    if sub.empty:
        return 0, None, 0
    return int(sub["iso3"].nunique()), int(sub["year"].max()), len(sub)


def compute_coverage(master: pd.DataFrame) -> list[IndicatorCoverage]:
    """Coverage stats for every registered indicator, in registry order."""
    # Normalise dtype: master stores indicator_code as category.
    codes = master["indicator_code"].astype(str)
    master = master.assign(indicator_code=codes)

    rows: list[IndicatorCoverage] = []
    for code, ind in REGISTRY.items():
        n_countries, latest_year, n_obs = _coverage_for_code(code, master)
        rows.append(
            IndicatorCoverage(
                code=code,
                present=n_obs > 0,
                n_countries=n_countries,
                latest_year=latest_year,
                n_obs=n_obs,
                available=ind.available,
                fallback_code=ind.fallback_code,
            )
        )
    return rows


def _status(cov: IndicatorCoverage, total_countries: int) -> str:
    """Human status tag for one indicator."""
    if not cov.available:
        return "GAP (unavailable)"
    if not cov.present:
        return "MISSING"
    if total_countries and cov.n_countries < LOW_COVERAGE_FRACTION * total_countries:
        return "LOW COVERAGE"
    return "OK"


def build_readiness_report(
    master_path: str | Path | None = None,
    out_path: str | Path | None = None,
) -> str:
    """
    Build the markdown readiness report and (optionally) write it to disk.

    Returns the markdown string regardless of whether it was written.
    """
    master_path = Path(master_path) if master_path else Path(PROCESSED_DIR) / "master.parquet"
    master = pd.read_parquet(master_path)
    master = master.assign(indicator_code=master["indicator_code"].astype(str))

    total_countries = int(master["iso3"].nunique())
    cov_list = compute_coverage(master)
    cov_by_code = {c.code: c for c in cov_list}

    lines: list[str] = []
    lines.append("# Data Readiness Report — Fiscal Space for Health")
    lines.append("")
    lines.append(f"_Generated {now_utc()}_")
    lines.append("")
    lines.append(
        f"master: {len(master):,} rows · {total_countries} countries · "
        f"{master['indicator_code'].nunique():,} codes · "
        f"years {int(master['year'].min())}–{int(master['year'].max())}"
    )
    lines.append("")

    # ── Summary by pillar ──────────────────────────────────────────────────
    lines.append("## Summary by pillar")
    lines.append("")
    lines.append("| Pillar | Indicators | Available | Median country coverage | Latest year |")
    lines.append("|---|---|---|---|---|")
    for key, label in PILLARS.items():
        inds = by_pillar(key)
        covs = [cov_by_code[i.code] for i in inds]
        present = [c for c in covs if c.present]
        n_avail = sum(1 for c in covs if c.available and c.present)
        med_cov = (
            int(pd.Series([c.n_countries for c in present]).median())
            if present else 0
        )
        latest = max((c.latest_year for c in present if c.latest_year), default=None)
        lines.append(
            f"| {label} | {len(inds)} | {n_avail}/{len(inds)} | "
            f"{med_cov} | {latest if latest else '—'} |"
        )
    lines.append("")

    # ── Detail by pillar ───────────────────────────────────────────────────
    lines.append("## Detail")
    for key, label in PILLARS.items():
        lines.append("")
        lines.append(f"### {label}")
        lines.append("")
        lines.append("| Indicator | Code | Source | Status | Countries | Latest | Obs |")
        lines.append("|---|---|---|---|---:|---:|---:|")
        for ind in by_pillar(key):
            c = cov_by_code[ind.code]
            lines.append(
                f"| {ind.label} | `{ind.code}` | {ind.source} | "
                f"{_status(c, total_countries)} | {c.n_countries} | "
                f"{c.latest_year if c.latest_year else '—'} | {c.n_obs:,} |"
            )
    lines.append("")

    # ── Data-pull gaps ─────────────────────────────────────────────────────
    gaps = [c for c in cov_list if not c.available or not c.present]
    lines.append("## Data-pull gaps")
    lines.append("")
    if not gaps:
        lines.append("None — every registered indicator is present in master.")
    else:
        lines.append("| Code | Reason | Fallback |")
        lines.append("|---|---|---|")
        for c in gaps:
            reason = "marked unavailable" if not c.available else "absent from master"
            fb = c.fallback_code or "—"
            fb_note = fb
            if c.fallback_code:
                fb_cov = cov_by_code.get(c.fallback_code)
                if fb_cov and fb_cov.present:
                    fb_note = f"`{fb}` ✓ ({fb_cov.n_countries} countries)"
                else:
                    fb_note = f"`{fb}` (also missing)"
            lines.append(f"| `{c.code}` | {reason} | {fb_note} |")
    lines.append("")

    # ── Registry ↔ master drift ────────────────────────────────────────────
    drift = validate_against_master(set(master["indicator_code"].unique()))
    lines.append("## Registry ↔ master drift")
    lines.append("")
    if not drift["missing_but_available"] and not drift["present_but_unavailable"]:
        lines.append("None — registry availability flags match master.")
    else:
        if drift["missing_but_available"]:
            lines.append("**Marked available but absent in master** "
                         "(fix the pull or flag `available=False`):")
            for code in drift["missing_but_available"]:
                ind = get(code)
                lines.append(f"- `{code}` — {ind.label if ind else ''}")
        if drift["present_but_unavailable"]:
            lines.append("")
            lines.append("**Marked unavailable but present in master** "
                         "(flip `available=True`):")
            for code in drift["present_but_unavailable"]:
                lines.append(f"- `{code}`")
    lines.append("")

    report = "\n".join(lines)

    if out_path is None:
        out_path = Path(LOGS_DIR) / "data_readiness.md"
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")

    return report


if __name__ == "__main__":
    from .utils import configure_logging

    configure_logging()
    text = build_readiness_report()
    out = Path(LOGS_DIR) / "data_readiness.md"
    print(f"Wrote {out} ({len(text):,} chars)")
    # Echo the summary table for quick console feedback.
    in_summary = False
    for line in text.splitlines():
        if line.startswith("## Summary"):
            in_summary = True
        elif line.startswith("## Detail"):
            break
        if in_summary:
            print(line)
