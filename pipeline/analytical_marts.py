"""
analytical_marts.py — Build joined analytical datasets for the PFM × health dashboard.

Inputs (read from PROCESSED_DIR):
  pefa.parquet        PEFA 2011 + 2016 pillar/PI scores
  world_bank.parquet  WDI health outcomes + macro
  ghed.parquet        WHO GHED financing moderators
  who_gho.parquet     UHC Service Coverage Index
  wgi.parquet         WGI + CPIA + FCV governance moderators

Outputs (written to PROCESSED_DIR):
  mart_pefa_health.parquet       Annual country panel, PEFA carry-forward 4y
  mart_pefa_events.parquet       Raw PEFA assessments + same-year outcomes
                                 (for country drill-down timelines)

Grain and join rules
────────────────────
`mart_pefa_health.parquet` is an annual country panel (iso3 × year).

PEFA scores are irregular (typically one assessment every 4–7 years).
We project them onto annual grain using a 4-year forward-carry window:
an assessment in year Y applies to years [Y, Y+3], unless a newer
assessment arrives sooner (then that takes over from its year).

This is an explicit, documented assumption. The mart includes
`pefa_years_since_assessment` so the dashboard can filter/fade rows that
are far from their source assessment. The window length is parameterised
(`CARRY_FORWARD_YEARS`) for sensitivity analysis.

Health outcomes, financing moderators, and governance moderators are
joined at their native annual grain with no imputation. Missing values
remain NaN so charts can show honest coverage.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from .config import PROCESSED_DIR
from .indicator_registry import HIGHER_BETTER, LOWER_BETTER, NEUTRAL, PILLARS, REGISTRY
from .utils import save_reference
from .wgi import FCV_CURRENT_ISO3, FCV_VINTAGE

logger = logging.getLogger(__name__)

CARRY_FORWARD_YEARS: int = 4

# ── Indicator codes pulled from each source parquet ────────────────────────
PEFA_CORE_CODES: dict[str, str] = {
    # PEFA 2016 framework (preferred when available)
    "PEFA16_OVERALL_AVG":       "pefa_overall",
    "PEFA16_BUDGET_RELIAB_AVG": "pefa_budget_reliab",
    "PEFA16_PILLAR3_AVG":       "pefa_pillar3_pcbe",  # Tapsoba headline
    "PEFA16_PI-22":             "pefa_pi22_arrears",
    "PEFA16_PI-23":             "pefa_pi23_lastmile",
    # PEFA 2011 framework (fallback — used when country has only 2011 data)
    "PEFA11_OVERALL_AVG":       "pefa11_overall",
    "PEFA11_BUDGET_RELIAB_AVG": "pefa11_budget_reliab",
    "PEFA11_PCBE_AVG":          "pefa11_pcbe",
}

WDI_CODES: dict[str, str] = {
    "SH.DYN.MORT":    "u5mr",
    "SH.STA.MMRT":    "mmr",
    "SP.DYN.LE00.IN": "life_expectancy",
    "SH.MLR.INCD.P3": "malaria_incidence",
    "SH.DYN.NMRT":    "neonatal_mortality",
    # Health system capacity — chain mediators
    "SH.MED.BEDS.ZS": "hospital_beds_per_1k",
}

GHED_CODES: dict[str, str] = {
    "GHED_gghed_che": "gghed_pct_che",   # Piatti 75% threshold
    "GHED_gghed_gge": "gghed_pct_gge",   # Tapsoba budget-priority moderator
    "GHED_che_gdp":   "che_pct_gdp",
    "GHED_gghed_pc_usd": "gghed_pc_usd",
}

WHO_GHO_CODES: dict[str, str] = {
    "UHC_INDEX_REPORTED":  "uhc_sci",
    "UHC_SCI_RMNCH":       "uhc_rmnch",
    # Health workforce — chain mediators (budget → workforce → coverage → outcomes)
    "HWF_0001":            "physicians_per_10k",   # medical doctors /10,000
    "HWF_0006":            "nurses_per_10k",       # nursing & midwifery /10,000
    # Maternal service coverage — chain mediators
    "WHS4_154":            "anc4_coverage",        # ANC ≥4 visits (%)
    "MDG_0000000025":      "skilled_birth_pct",    # births attended by skilled personnel (%)
}

WGI_CODES: dict[str, str] = {
    "GOV_WGI_GE.EST": "wgi_govt_effectiveness",
    "GOV_WGI_CC.EST": "wgi_control_corruption",
    "GOV_WGI_RL.EST": "wgi_rule_of_law",
    "IQ.CPA.FINQ.XQ": "cpia_fin_mgmt",
    "IQ.CPA.IRAI.XQ": "cpia_irai",
}


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _pivot_long_to_wide(
    long: pd.DataFrame,
    code_to_col: dict[str, str],
) -> pd.DataFrame:
    """
    Select rows whose indicator_code is in `code_to_col`, rename, and pivot
    to wide iso3×year grain. Returns an empty frame with the expected columns
    if no rows match (keeps downstream joins safe).
    """
    sub = long[long["indicator_code"].isin(code_to_col.keys())].copy()
    if sub.empty:
        logger.warning("No rows matched any of: %s", list(code_to_col.keys()))
        return pd.DataFrame(columns=["iso3", "year", *code_to_col.values()])
    sub["indicator_code"] = sub["indicator_code"].astype(str)
    sub = sub[["iso3", "year", "indicator_code", "value"]].dropna(subset=["iso3", "year"])
    # If the same (iso3, year, code) appears more than once (should be rare),
    # keep the last value.
    sub = sub.drop_duplicates(["iso3", "year", "indicator_code"], keep="last")
    wide = sub.pivot(index=["iso3", "year"], columns="indicator_code", values="value").reset_index()
    wide.columns.name = None
    wide = wide.rename(columns=code_to_col)
    # Ensure all expected columns exist (missing indicators become NaN columns)
    for col in code_to_col.values():
        if col not in wide.columns:
            wide[col] = np.nan
    wide["year"] = wide["year"].astype(int)
    return wide[["iso3", "year", *code_to_col.values()]]


def _add_current_fcv_context(frame: pd.DataFrame) -> pd.DataFrame:
    """Attach FY2026 FCV as current context, never as historical status."""
    out = frame.copy()
    out["fcv_current"] = out["iso3"].astype(str).isin(FCV_CURRENT_ISO3).astype("int8")
    out["fcv_vintage"] = FCV_VINTAGE
    return out


def _project_pefa_to_annual(
    pefa_wide: pd.DataFrame,
    all_years: list[int],
    carry_years: int,
) -> pd.DataFrame:
    """
    Project irregular PEFA assessments onto an annual panel by forward-
    carrying each score for up to `carry_years` years (inclusive of the
    assessment year), until superseded by a newer assessment.

    Returns an iso3×year frame with:
      - all PEFA columns from pefa_wide
      - pefa_assessment_year (int) — year of the assessment that supplies the row
      - pefa_years_since_assessment (int) — year - pefa_assessment_year
      - pefa_framework (str) — "2016", "2011", or "2011+2016" when both contributed
    Rows with no valid assessment within the window are dropped.
    """
    if pefa_wide.empty:
        return pd.DataFrame()

    pefa_cols = [c for c in pefa_wide.columns if c not in ("iso3", "year")]

    # For each country, step through years and forward-fill with window decay.
    out_rows: list[dict] = []
    for iso3, grp in pefa_wide.groupby("iso3", sort=False):
        # All assessment years for this country, sorted
        grp = grp.sort_values("year")
        # Separate 2011 vs 2016 columns
        cols_2016 = [c for c in pefa_cols if c.startswith("pefa_") and not c.startswith("pefa11_")]
        cols_2011 = [c for c in pefa_cols if c.startswith("pefa11_")]

        # Per-column forward-carry index: last year an assessment supplied a value
        last_seen: dict[str, tuple[int, float]] = {}  # col -> (assessment_year, value)
        # Build a dict {assessment_year: row_dict}
        grp_dict = {int(r["year"]): r for _, r in grp.iterrows()}

        for y in all_years:
            # Update last_seen with any assessment arriving this year
            if y in grp_dict:
                row = grp_dict[y]
                for col in pefa_cols:
                    val = row.get(col)
                    if pd.notna(val):
                        last_seen[col] = (y, float(val))

            # Emit values for each column if the last assessment is within window
            record = {"iso3": iso3, "year": y}
            contributing_years: list[int] = []
            framework_flags: set[str] = set()
            for col in pefa_cols:
                if col in last_seen:
                    ay, val = last_seen[col]
                    age = y - ay
                    if age < carry_years:
                        record[col] = val
                        contributing_years.append(ay)
                        framework_flags.add("2011" if col in cols_2011 else "2016")
                    else:
                        record[col] = np.nan
                else:
                    record[col] = np.nan

            if contributing_years:
                # "Assessment year" = most recent among contributing columns
                record["pefa_assessment_year"] = max(contributing_years)
                record["pefa_years_since_assessment"] = y - record["pefa_assessment_year"]
                record["pefa_framework"] = "+".join(sorted(framework_flags)) or None
                out_rows.append(record)

    if not out_rows:
        return pd.DataFrame()

    df = pd.DataFrame(out_rows)
    # Type coercions
    df["year"] = df["year"].astype(int)
    df["pefa_assessment_year"] = df["pefa_assessment_year"].astype("Int64")
    df["pefa_years_since_assessment"] = df["pefa_years_since_assessment"].astype("Int64")
    return df


def _derive_public_financing_regime(gghed_pct_che: pd.Series) -> pd.Series:
    """Classify into <50 / 50-75 / >75 bins per Piatti's framing."""
    bins = pd.cut(
        gghed_pct_che,
        bins=[-np.inf, 50, 75, np.inf],
        labels=["low (<50%)", "mid (50-75%)", "high (>75%)"],
    )
    return bins.astype(object)


# ─────────────────────────────────────────────
# Build functions
# ─────────────────────────────────────────────

def _load_source(name: str) -> pd.DataFrame:
    path = Path(PROCESSED_DIR) / f"{name}.parquet"
    if not path.exists():
        logger.warning("Source missing: %s — returning empty frame", path)
        return pd.DataFrame(columns=["iso3", "year", "indicator_code", "value"])
    df = pd.read_parquet(path)
    # Coerce from category dtype (cast_master_dtypes) back to str for filtering
    for c in ("iso3", "indicator_code", "source"):
        if c in df.columns and str(df[c].dtype) == "category":
            df[c] = df[c].astype(str)
    if "year" in df.columns:
        df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
    return df


def build_mart_pefa_health(
    carry_years: int = CARRY_FORWARD_YEARS,
    save: bool = True,
) -> pd.DataFrame:
    """Build the annual PEFA × health × moderators country-year mart."""
    print(f"\n{'='*60}")
    print(f" Building mart_pefa_health  —  carry_forward={carry_years}y")
    print(f"{'='*60}")

    pefa   = _load_source("pefa")
    wdi    = _load_source("world_bank")
    ghed   = _load_source("ghed")
    whogho = _load_source("who_gho")
    gov    = _load_source("wgi")

    pefa_wide   = _pivot_long_to_wide(pefa,   PEFA_CORE_CODES)
    wdi_wide    = _pivot_long_to_wide(wdi,    WDI_CODES)
    ghed_wide   = _pivot_long_to_wide(ghed,   GHED_CODES)
    whogho_wide = _pivot_long_to_wide(whogho, WHO_GHO_CODES)
    gov_wide    = _pivot_long_to_wide(gov,    WGI_CODES)

    # Build annual grid over the union of years present in any source.
    year_source = pd.concat(
        [df["year"] for df in (pefa_wide, wdi_wide, ghed_wide, whogho_wide, gov_wide) if not df.empty],
        ignore_index=True,
    )
    if year_source.empty:
        logger.warning("No year data found in any source — aborting mart build.")
        return pd.DataFrame()
    ymin, ymax = int(year_source.min()), int(year_source.max())
    all_years = list(range(ymin, ymax + 1))

    # Project PEFA onto the annual grid
    pefa_annual = _project_pefa_to_annual(pefa_wide, all_years, carry_years)

    # The base panel is the union of all (iso3, year) pairs from any source.
    bases = [df[["iso3", "year"]] for df in (pefa_annual, wdi_wide, ghed_wide, gov_wide) if not df.empty]
    base = pd.concat(bases, ignore_index=True).drop_duplicates().reset_index(drop=True)

    mart = base
    for right in (pefa_annual, wdi_wide, ghed_wide, whogho_wide, gov_wide):
        if right.empty:
            continue
        mart = mart.merge(right, on=["iso3", "year"], how="left")

    # Piatti regime flag
    if "gghed_pct_che" in mart.columns:
        mart["public_financing_regime"] = _derive_public_financing_regime(mart["gghed_pct_che"])

    # FCV is current FY2026 context. It is deliberately not joined by year and
    # must not be interpreted as historical status for each panel row.
    mart = _add_current_fcv_context(mart)

    # Order columns nicely
    id_cols = ["iso3", "year",
               "pefa_assessment_year", "pefa_years_since_assessment",
               "pefa_framework", "public_financing_regime",
               "fcv_current", "fcv_vintage"]
    pefa_cols = [c for c in mart.columns if c.startswith("pefa_") or c.startswith("pefa11_")]
    pefa_cols = [c for c in pefa_cols if c not in id_cols]
    # WHO_GHO_CODES now includes both health outcomes AND chain mediators;
    # split them so chain mediators sit after outcome columns in ordering.
    _gho_outcomes = ["uhc_sci", "uhc_rmnch"]
    _gho_chain    = [v for v in WHO_GHO_CODES.values() if v not in _gho_outcomes]
    _wdi_chain    = ["hospital_beds_per_1k"]
    _wdi_outcomes = [v for v in WDI_CODES.values() if v not in _wdi_chain]
    outcome_cols  = _wdi_outcomes + _gho_outcomes + _gho_chain + _wdi_chain
    moderator_cols = list(GHED_CODES.values()) + list(WGI_CODES.values())

    ordered = []
    seen = set()
    for c in id_cols + pefa_cols + outcome_cols + moderator_cols:
        if c in mart.columns and c not in seen:
            ordered.append(c)
            seen.add(c)
    # Append any stray columns
    for c in mart.columns:
        if c not in seen:
            ordered.append(c)
    mart = mart[ordered].sort_values(["iso3", "year"]).reset_index(drop=True)

    print(f"  Rows:               {len(mart):,}")
    print(f"  Countries:          {mart['iso3'].nunique():,}")
    print(f"  Year range:         {int(mart['year'].min())}–{int(mart['year'].max())}")
    print(f"  Columns:            {len(mart.columns)}")
    have_pefa = mart["pefa_pillar3_pcbe"].notna() if "pefa_pillar3_pcbe" in mart else pd.Series([False])
    print(f"  Rows w/ 2016 pillar-3 score: {have_pefa.sum():,}")
    print(f"  Rows w/ U5MR:                {mart['u5mr'].notna().sum() if 'u5mr' in mart else 0:,}")
    print(f"  Rows w/ GGHE-D % CHE:        {mart['gghed_pct_che'].notna().sum() if 'gghed_pct_che' in mart else 0:,}")
    print(f"  Rows w/ WGI GE.EST:          {mart['wgi_govt_effectiveness'].notna().sum() if 'wgi_govt_effectiveness' in mart else 0:,}")

    if save and not mart.empty:
        save_reference(mart, "mart_pefa_health", PROCESSED_DIR)

    return mart


def build_mart_pefa_events(save: bool = True) -> pd.DataFrame:
    """
    Long-format mart of raw PEFA assessments (no carry-forward), each joined
    with the corresponding country×year outcomes. Used by the country
    drill-down timeline where each assessment is a vertical event.
    """
    print(f"\n{'='*60}")
    print(f" Building mart_pefa_events  —  raw assessment events")
    print(f"{'='*60}")

    pefa = _load_source("pefa")
    if pefa.empty:
        logger.warning("pefa.parquet is empty — skipping events mart")
        return pd.DataFrame()

    pefa_wide = _pivot_long_to_wide(pefa, PEFA_CORE_CODES)
    pefa_wide = pefa_wide.rename(columns={"year": "assessment_year"})
    pefa_wide["assessment_year"] = pefa_wide["assessment_year"].astype(int)

    # Join WDI outcomes at assessment year
    wdi_wide = _pivot_long_to_wide(_load_source("world_bank"), WDI_CODES)
    wdi_wide = wdi_wide.rename(columns={"year": "assessment_year"})
    mart = pefa_wide.merge(wdi_wide, on=["iso3", "assessment_year"], how="left")

    # Governance moderators at same year
    gov_wide = _pivot_long_to_wide(_load_source("wgi"), WGI_CODES)
    gov_wide = gov_wide.rename(columns={"year": "assessment_year"})
    mart = mart.merge(gov_wide, on=["iso3", "assessment_year"], how="left")

    ghed_wide = _pivot_long_to_wide(_load_source("ghed"), GHED_CODES)
    ghed_wide = ghed_wide.rename(columns={"year": "assessment_year"})
    mart = mart.merge(ghed_wide, on=["iso3", "assessment_year"], how="left")

    # Assessment years often pre-date FY2026. Keep the present-day
    # classification visibly separate from same-year observations.
    mart = _add_current_fcv_context(mart)

    mart = mart.sort_values(["iso3", "assessment_year"]).reset_index(drop=True)
    print(f"  Assessment rows: {len(mart):,}")
    print(f"  Countries:       {mart['iso3'].nunique():,}")
    print(f"  Year range:      {int(mart['assessment_year'].min())}–{int(mart['assessment_year'].max())}")

    if save and not mart.empty:
        save_reference(mart, "mart_pefa_events", PROCESSED_DIR)

    return mart


# ─────────────────────────────────────────────
# Fiscal-space composite mart
# ─────────────────────────────────────────────
#
# Builds the peer-normalised pillar sub-indices and the headline Fiscal Space
# for Health Index that drive the redesigned fiscal-space page.
#
# Method (documented, parameterised; see methodology page):
#   1. Each *scorable* indicator is rescaled to 0–100 within its income-group
#      peers using a winsorised (P5–P95) min-max so outliers don't dominate.
#      Direction-aware: LOWER_BETTER indicators are inverted so 100 always means
#      "more fiscal space". An indicator is scorable only if it is available,
#      has a real direction (NEUTRAL indicators are context-only), and is not
#      flagged normalization="none" (which excludes absolute-US$ levels and
#      income levels that aren't comparable / would double-count).
#   2. A pillar score is the EQUAL-WEIGHTED mean of the indicators whose PRIMARY
#      pillar (registry `domain`) is that pillar. Scoring by domain — not the
#      `pillars` overlap set used for page display — ensures no indicator is
#      double-counted across pillars in the index. Equal weights follow the
#      JRC/OECD default absent a theoretical basis for differential weights;
#      weight sensitivity analysis is a planned addition.
#   3. Efficiency is special-cased: rather than averaging spend indicators (which
#      would not measure efficiency), it is the peer-normalised gap between
#      OUTCOME attainment (life expectancy, U5MR, MMR, UHC SCI) and SPENDING
#      level (govt health $/capita) — a transparent first-order "value for money"
#      proxy. It is NOT a frontier (DEA/SFA) estimate and does not control for
#      non-health-system drivers of outcomes; a DEA/SFA upgrade is planned.
#   4. The index is the GEOMETRIC mean of available pillar scores — a near-zero
#      pillar cannot be masked by a strong one (no full compensability; cf. HDI).
#   5. Named composites alongside the index: a debt-service-vs-health crowding-out
#      ratio (external debt service % GNI ÷ govt health % GDP — GNI≈GDP
#      approximation, external debt service only) and a donor transition-risk
#      score (inverse of external-dependency; a proxy, not a Gavi/GF model).
#
# Honesty: rows are emitted only where >= MIN_PILLARS_FOR_INDEX pillars have
# data; every score carries a coverage column so the UI can fade thin estimates.

# Winsor bounds and minimum pillars required to publish an index value.
# The headline index needs broad coverage so a country-year isn't ranked on a
# lucky subset of pillars; thinly-covered years still get pillar scores (for the
# pillar pages) but no headline index. Coverage columns let the UI fade the rest.
WINSOR_LO, WINSOR_HI = 0.05, 0.95
MIN_PILLARS_FOR_INDEX = 4
# Index aggregation clips pillar scores into [1, 100] so a true 0 can't send the
# geometric mean to -inf; 1 still represents "effectively no space".
INDEX_FLOOR = 1.0


def _income_groups() -> pd.Series:
    """Map iso3 -> income group label (for peer normalisation). 'GLOBAL' fallback."""
    path = Path(PROCESSED_DIR) / "country_metadata.parquet"
    if not path.exists():
        logger.warning("country_metadata missing — peer normalisation falls back to GLOBAL")
        return pd.Series(dtype=str)
    cm = pd.read_parquet(path)
    col = "wb_income_group" if "wb_income_group" in cm.columns else None
    if col is None:
        return pd.Series(dtype=str)
    return cm.set_index("iso3")[col].astype(str)


# Outcome indicators (with direction) and the spending input used to build the
# efficiency "value for money" proxy.
EFF_OUTCOMES: dict[str, int] = {
    "SP.DYN.LE00.IN":     HIGHER_BETTER,
    "SH.DYN.MORT":        LOWER_BETTER,
    "SH.STA.MMRT":        LOWER_BETTER,
    "UHC_INDEX_REPORTED": HIGHER_BETTER,
}
EFF_INPUT_CODE = "GHED_gghed_pc_usd"


def _scorable_codes(master_codes: set[str]) -> list[str]:
    """
    Registry indicators eligible for index scoring: available, present, with a
    real direction (NEUTRAL excluded — context only) and not flagged
    normalization="none" (which excludes absolute-US$ levels / income levels).
    """
    return [
        code for code, ind in REGISTRY.items()
        if ind.available
        and ind.normalization != "none"
        and ind.direction != NEUTRAL
        and code in master_codes
    ]


def _normalise_peer(sub: pd.DataFrame, direction: int) -> pd.Series:
    """
    Winsorised min-max to 0–100 within each peer group (sub has 'value','grp').
    Direction-aware. Degenerate groups (no spread) map to a neutral 50.
    """
    grouped = sub.groupby("grp")["value"]
    lo = grouped.transform(lambda x: x.quantile(WINSOR_LO))
    hi = grouped.transform(lambda x: x.quantile(WINSOR_HI))
    rng = (hi - lo)
    scaled = ((sub["value"] - lo) / rng.where(rng > 0)).clip(0, 1)
    if direction == LOWER_BETTER:
        scaled = 1 - scaled
    return (scaled * 100).fillna(50.0)


def build_mart_fiscal_space(save: bool = True) -> pd.DataFrame:
    """Build the fiscal-space composite mart (iso3 × year)."""
    print(f"\n{'='*60}")
    print(" Building mart_fiscal_space  —  pillar sub-indices + FSH index")
    print(f"{'='*60}")

    master = _load_source("master") if (Path(PROCESSED_DIR) / "master.parquet").exists() \
        else pd.DataFrame()
    if master.empty:
        logger.warning("master.parquet empty/missing — skipping fiscal-space mart")
        return pd.DataFrame()
    master = master.assign(indicator_code=master["indicator_code"].astype(str))

    income = _income_groups()
    master["grp"] = master["iso3"].map(income).fillna("GLOBAL")

    master_codes = set(master["indicator_code"].unique())
    scorable = _scorable_codes(master_codes)
    if not scorable:
        logger.warning("No scorable indicators present — skipping fiscal-space mart")
        return pd.DataFrame()

    # 1. Normalise each scorable indicator to 0–100 (long form).
    norm_frames: list[pd.DataFrame] = []
    for code in scorable:
        sub = master[master["indicator_code"] == code][["iso3", "year", "value", "grp"]].dropna(
            subset=["value"]
        )
        if sub.empty:
            continue
        sub = sub.copy()
        sub["score"] = _normalise_peer(sub, REGISTRY[code].direction)
        sub["code"] = code
        norm_frames.append(sub[["iso3", "year", "code", "score"]])

    norm_long = pd.concat(norm_frames, ignore_index=True)
    wide = norm_long.pivot_table(
        index=["iso3", "year"], columns="code", values="score"
    )

    # 2. Pillar scores + coverage. Membership is by PRIMARY pillar (registry
    #    `domain`), NOT the `pillars` overlap set used for page display — so no
    #    indicator is double-counted across pillars in the index.
    out = pd.DataFrame(index=wide.index)
    pillar_score_cols: list[str] = []
    for key in PILLARS:
        members = [c for c in scorable if REGISTRY[c].domain == key and c in wide.columns]
        if not members:
            continue
        block = wide[members]
        out[f"pillar_{key}_score"] = block.mean(axis=1)
        out[f"pillar_{key}_coverage"] = block.notna().mean(axis=1)
        pillar_score_cols.append(f"pillar_{key}_score")

    # 2b. Efficiency pillar is special-cased: outcome attainment vs spending
    #     level (a value-for-money proxy), not an average of spend indicators.
    eff = _efficiency_score(master)
    if not eff.empty:
        out["pillar_efficiency_score"] = eff["eff_score"].reindex(out.index)
        out["pillar_efficiency_coverage"] = eff["eff_cov"].reindex(out.index)
        if "pillar_efficiency_score" not in pillar_score_cols:
            pillar_score_cols.append("pillar_efficiency_score")

    # 3. Geometric-mean index over available pillars.
    pscores = out[pillar_score_cols].clip(lower=INDEX_FLOOR)
    n_pillars = pscores.notna().sum(axis=1)
    log_mean = np.log(pscores).mean(axis=1)  # skips NaN
    out["fsh_index"] = np.exp(log_mean).where(n_pillars >= MIN_PILLARS_FOR_INDEX)
    # Coverage is always out of the full pillar set, not just the pillars that
    # happen to have data in this build, so the fraction is comparable.
    out["fsh_index_coverage"] = n_pillars / len(PILLARS)

    # 4. Named composites (raw, interpretable — not part of the index).
    out = _add_crowding_out(out, master)
    out = _add_transition_risk(out)

    mart = out.reset_index()
    # Keep any country-year with at least one pillar score (pillar pages need
    # these); fsh_index itself is only populated where coverage is sufficient.
    keep = mart[pillar_score_cols].notna().any(axis=1)
    mart = mart[keep].copy()
    mart = mart.sort_values(["iso3", "year"]).reset_index(drop=True)

    # Round score-like columns for compact storage / clean display.
    score_cols = [c for c in mart.columns if c.endswith("_score") or c == "fsh_index"]
    mart[score_cols] = mart[score_cols].round(1)
    cov_cols = [c for c in mart.columns if c.endswith("_coverage")]
    mart[cov_cols] = mart[cov_cols].round(2)

    # Per-indicator component scores that build each pillar (for the UI breakdown).
    components = _build_components(norm_long, eff)

    print(f"  Rows:        {len(mart):,}")
    print(f"  Countries:   {mart['iso3'].nunique():,}")
    if len(mart):
        print(f"  Year range:  {int(mart['year'].min())}–{int(mart['year'].max())}")
    print(f"  Pillars:     {len(pillar_score_cols)} of {len(PILLARS)}")
    print(f"  Component rows: {len(components):,}")

    if save and not mart.empty:
        save_reference(mart, "mart_fiscal_space", PROCESSED_DIR)
        if not components.empty:
            save_reference(components, "mart_fiscal_components", PROCESSED_DIR)

    return mart


def _efficiency_score(master: pd.DataFrame) -> pd.DataFrame:
    """
    Spending-efficiency proxy (0–100), indexed by (iso3, year).

    Defined as the peer-normalised gap between OUTCOME attainment and SPENDING
    level: 50 + (attainment − spend_rank) / 2, clipped to [0, 100]. A country
    that achieves better outcomes than its spending rank would predict scores
    above 50 ("more value for money"); below 50 means the reverse; 50 is "on the
    peer line". Both attainment and spend are winsorised peer min-max within
    income group. This is a transparent first-order proxy, NOT a frontier
    (DEA/SFA) estimate, and does not control for non-health drivers of outcomes.
    """
    att_frames: list[pd.Series] = []
    for code, direction in EFF_OUTCOMES.items():
        sub = master[master["indicator_code"] == code][
            ["iso3", "year", "value", "grp"]
        ].dropna(subset=["value"])
        if sub.empty:
            continue
        sub = sub.copy()
        sub["s"] = _normalise_peer(sub, direction)
        att_frames.append(sub.set_index(["iso3", "year"])["s"].rename(code))
    if not att_frames:
        return pd.DataFrame()

    att = pd.concat(att_frames, axis=1)
    attainment = att.mean(axis=1)
    eff_cov = att.notna().mean(axis=1)

    spend = master[master["indicator_code"] == EFF_INPUT_CODE][
        ["iso3", "year", "value", "grp"]
    ].dropna(subset=["value"])
    if spend.empty:
        return pd.DataFrame()
    spend = spend.copy()
    spend["s"] = _normalise_peer(spend, HIGHER_BETTER)
    spend_rank = spend.set_index(["iso3", "year"])["s"]

    df = pd.DataFrame({"attainment": attainment, "spend": spend_rank, "eff_cov": eff_cov})
    df = df.dropna(subset=["attainment", "spend"])
    df["eff_score"] = (50 + (df["attainment"] - df["spend"]) / 2).clip(0, 100)
    # attainment / spend are returned too so the UI can show the proxy's parts.
    return df[["eff_score", "eff_cov", "attainment", "spend"]]


def _build_components(norm_long: pd.DataFrame, eff: pd.DataFrame) -> pd.DataFrame:
    """
    Long-format per-indicator normalised scores that *build* each pillar score,
    for the "how this score is built" breakdown in the UI.

    One row per (iso3, year, pillar, code, norm_score). Pillar membership is the
    indicator's PRIMARY pillar (registry domain) — the same basis the index uses
    — so the breakdown sums to the displayed pillar score. The efficiency pillar
    is special-cased: its parts are the proxy's two inputs, outcome attainment
    (`_outcome_attainment`) and spending level (`_spend_level`).
    """
    comp = norm_long.rename(columns={"score": "norm_score"}).copy()
    comp["pillar"] = comp["code"].map(lambda c: REGISTRY[c].domain if c in REGISTRY else None)
    frames = [comp[["iso3", "year", "pillar", "code", "norm_score"]]]

    if not eff.empty:
        e = eff.reset_index()
        for pseudo_code, col in [("_outcome_attainment", "attainment"), ("_spend_level", "spend")]:
            if col in e.columns:
                sub = e[["iso3", "year"]].copy()
                sub["pillar"] = "efficiency"
                sub["code"] = pseudo_code
                sub["norm_score"] = e[col].to_numpy()
                frames.append(sub)

    out = pd.concat(frames, ignore_index=True).dropna(subset=["norm_score", "pillar"])
    out["norm_score"] = out["norm_score"].round(1)
    return out.sort_values(["iso3", "year", "pillar"]).reset_index(drop=True)


def _add_crowding_out(out: pd.DataFrame, master: pd.DataFrame) -> pd.DataFrame:
    """
    Debt-service-vs-health crowding-out ratio: debt service (% GNI) divided by
    government health spending (% GDP). A ratio > 1 means more is spent
    servicing debt than on public health.
    """
    def _series(code: str) -> pd.Series:
        s = master[master["indicator_code"] == code].set_index(["iso3", "year"])["value"]
        return s[~s.index.duplicated(keep="last")]

    debt_service = _series("DT.TDS.DECT.GN.ZS")
    gov_health = _series("GHED_gghed_gdp")
    ratio = (debt_service / gov_health.where(gov_health > 0)).reindex(out.index)
    out["crowding_out_ratio"] = ratio.round(2)
    return out


def _add_transition_risk(out: pd.DataFrame) -> pd.DataFrame:
    """
    Donor transition-risk score (0–100, higher = more at risk): the inverse of
    the external-financing pillar score (high external dependency -> high risk).
    """
    ext_col = "pillar_external_score"
    if ext_col in out.columns:
        out["transition_risk_score"] = (100 - out[ext_col]).round(1)
    return out


def build_all(save: bool = True) -> None:
    """Build every analytical mart. Call from run_pipeline.py after master build."""
    build_mart_pefa_health(save=save)
    build_mart_pefa_events(save=save)
    build_mart_fiscal_space(save=save)


if __name__ == "__main__":
    from .utils import configure_logging
    configure_logging()
    build_all()
