"""
wgi.py — Governance "moderator" indicators for the PFM × health dashboard.

Three related sources, all from the World Bank family, bundled into one
module because they share the wbgapi fetch pattern and serve the same
analytical role: conditioning variables that determine *when* PFM quality
translates into better health outcomes.

1. Worldwide Governance Indicators (WGI) — dataset 3
     GE.EST  Government Effectiveness  (Tapsoba's "governance multiplier")
     CC.EST  Control of Corruption
     RL.EST  Rule of Law
     RQ.EST  Regulatory Quality
     PV.EST  Political Stability & Absence of Violence
     VA.EST  Voice and Accountability
   All are -2.5..+2.5 z-scores, annual, ~215 countries.

2. CPIA (Country Policy and Institutional Assessment) — dataset 31
   IDA countries only (~75). Ordinal 1–6.
     IQ.CPA.FINQ.XQ   Quality of budgetary and financial management    ← PFM proxy
     IQ.CPA.PUBS.XQ   Quality of public administration
     IQ.CPA.TRAN.XQ   Transparency, accountability & corruption in public sector
     IQ.CPA.FISP.XQ   Fiscal policy
     IQ.CPA.DEBT.XQ   Debt policy
     IQ.CPA.IRAI.XQ   CPIA IRAI average (overall cluster D mean)

3. FCV — Fragile and Conflict-affected Situations classification
   Annual list maintained by the World Bank. Emitted as a 0/1 flag
   indicator `WB_FCV_STATUS` so it aggregates into the standard long
   schema without special-casing downstream. Current list is the FY26
   classification (published July 2025); update `_FCV_LATEST_LIST` when
   the Bank publishes the next list.

License: WGI & CPIA are CC-BY 4.0. FCV list is public.
"""

from __future__ import annotations

import logging
from concurrent.futures import TimeoutError as FuturesTimeoutError

import pandas as pd
import wbgapi as wb

from .config import END_YEAR, PROCESSED_DIR, START_YEAR
from .utils import (
    get_country_name,
    log_skip,
    make_standard_df,
    now_utc,
    resilient_fetch,
    save_data,
)

logger = logging.getLogger(__name__)

WGI_INDICATORS: dict[str, str] = {
    # Note: WB's 2024 WGI refresh renamed these from the old
    # GE.EST / CC.EST codes. The z-score estimates live in *.EST; the
    # 0–100 percentile-rank-equivalent scores live in *.SC.
    "GOV_WGI_GE.EST": "WGI — Government Effectiveness (z-score, -2.5..2.5)",
    "GOV_WGI_CC.EST": "WGI — Control of Corruption (z-score)",
    "GOV_WGI_RL.EST": "WGI — Rule of Law (z-score)",
    "GOV_WGI_RQ.EST": "WGI — Regulatory Quality (z-score)",
    "GOV_WGI_PV.EST": "WGI — Political Stability & Absence of Violence (z-score)",
    "GOV_WGI_VA.EST": "WGI — Voice and Accountability (z-score)",
}

CPIA_INDICATORS: dict[str, str] = {
    "IQ.CPA.FINQ.XQ": "CPIA — Quality of budgetary and financial management (1-6)",
    "IQ.CPA.PUBS.XQ": "CPIA — Quality of public administration (1-6)",
    "IQ.CPA.TRAN.XQ": "CPIA — Transparency, accountability & corruption (1-6)",
    "IQ.CPA.FISP.XQ": "CPIA — Fiscal policy (1-6)",
    "IQ.CPA.DEBT.XQ": "CPIA — Debt policy (1-6)",
    "IQ.CPA.IRAI.XQ": "CPIA — IRAI overall average (1-6)",
}

# World Bank FY26 Classification of Fragile and Conflict-Affected Situations
# (published July 2025 — lists 39 economies).
# Source: https://www.worldbank.org/en/topic/fragilityconflictviolence/brief/harmonized-list-of-fragile-situations
FCV_CURRENT_ISO3: frozenset[str] = frozenset({
    # High-intensity conflict
    "AFG", "BFA", "CMR", "COD", "ETH", "HTI", "MLI", "MMR", "MOZ", "NER",
    "NGA", "PSE", "SOM", "SDN", "SSD", "SYR", "UKR", "YEM",
    # Medium-intensity conflict / institutional & social fragility
    "BDI", "CAF", "TCD", "COM", "COG", "GNB", "IRQ", "KIR", "LBN", "LBR",
    "LBY", "MHL", "FSM", "PNG", "SLB", "TLS", "TUV", "VEN", "ZWE", "XKX",
    "GIN",
})
# FCV applies from FY26 (World Bank fiscal year starts 1 July 2025) → calendar 2025.
FCV_REFERENCE_YEAR = 2025
FCV_VINTAGE = "FY2026"


# ─────────────────────────────────────────────
# Shared wbgapi fetch helper
# ─────────────────────────────────────────────

def _fetch_wb_indicator(
    code: str,
    name: str,
    source_id: int,
    start_year: int,
    end_year: int,
    pulled_at: str,
    source_label: str,
) -> pd.DataFrame | None:
    """Fetch one wbgapi indicator from a specific source database; return standard long."""
    def _call() -> pd.DataFrame:
        return wb.data.DataFrame(
            code,
            time=range(start_year, end_year + 1),
            labels=False,
            numericTimeKeys=True,
            db=source_id,
        )

    try:
        raw = resilient_fetch(
            _call, timeout=120, max_retries=3, backoff=1.0,
            label=f"{source_label}/{code}",
        )
    except FuturesTimeoutError:
        log_skip(source_label, code, name, "timeout", "120s", pulled_at)
        logger.warning("%s timeout: %s", source_label, code)
        return None
    except Exception as exc:
        err = str(exc)
        reason = "http_404" if "404" in err else "api_error"
        log_skip(source_label, code, name, reason, f"after retries: {err}", pulled_at)
        logger.warning("%s error for %s: %s", source_label, code, err)
        return None

    raw = raw.reset_index()
    id_col = raw.columns[0]
    melted = raw.melt(id_vars=[id_col], var_name="year", value_name="value")
    melted = melted.rename(columns={id_col: "iso3"})
    melted = melted.dropna(subset=["value"])
    # Drop aggregate / region codes
    melted = melted[melted["iso3"].str.len() == 3]
    melted = melted[~melted["iso3"].str.contains(r"\d", regex=True)]

    records = [
        {
            "iso3":           row["iso3"],
            "country_name":   get_country_name(str(row["iso3"])),
            "year":           int(row["year"]),
            "indicator_code": code,
            "indicator_name": name,
            "value":          float(row["value"]),
            "source":         source_label,
            "pulled_at":      pulled_at,
        }
        for _, row in melted.iterrows()
    ]
    if not records:
        log_skip(source_label, code, name, "no_data", "0 rows", pulled_at)
        return None
    return make_standard_df(records)


# ─────────────────────────────────────────────
# FCV — build from static list
# ─────────────────────────────────────────────

def _build_fcv_frame(pulled_at: str) -> pd.DataFrame:
    """
    Emit the FCV classification as annual 0/1 rows for a rolling window.

    Since we only reliably know the *current* FY26 list, we emit that list
    for the current calendar year only. Downstream consumers can carry-
    forward the flag as needed via mart logic.
    """
    records = [
        {
            "iso3":           iso3,
            "country_name":   get_country_name(iso3),
            "year":           FCV_REFERENCE_YEAR,
            "indicator_code": "WB_FCV_STATUS",
            "indicator_name": "WB Fragile & Conflict-Affected Situations (1 = FCS, FY26 list)",
            "value":          1.0,
            "source":         "World Bank FCV",
            "pulled_at":      pulled_at,
        }
        for iso3 in sorted(FCV_CURRENT_ISO3)
    ]
    return make_standard_df(records)


# ─────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────

def fetch_wgi(
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    save: bool = True,
    include_cpia: bool = True,
    include_fcv: bool = True,
) -> pd.DataFrame:
    """
    Fetch Worldwide Governance Indicators, CPIA scores, and the current
    FCV classification list. Returns a single standard-schema DataFrame.
    """
    print(f"\n{'='*60}")
    print(" Governance moderators  —  WGI + CPIA + FCV")
    print(f"{'='*60}")
    pulled_at = now_utc()
    frames: list[pd.DataFrame] = []

    for code, name in WGI_INDICATORS.items():
        df = _fetch_wb_indicator(code, name, 3, start_year, end_year, pulled_at, "WGI")
        if df is not None:
            frames.append(df)

    if include_cpia:
        for code, name in CPIA_INDICATORS.items():
            df = _fetch_wb_indicator(code, name, 31, start_year, end_year, pulled_at, "CPIA")
            if df is not None:
                frames.append(df)

    if include_fcv:
        frames.append(_build_fcv_frame(pulled_at))

    if not frames:
        logger.warning("No governance data retrieved.")
        return pd.DataFrame()

    df = pd.concat(frames, ignore_index=True)
    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    print(f"  Records:      {len(df):,}")
    print(f"  Countries:    {df['iso3'].nunique():,}")
    print(f"  Indicators:   {df['indicator_code'].nunique():,}")
    print(f"  Sources:      {sorted(df['source'].unique())}")
    print(f"  Year range:   {int(df['year'].min())}–{int(df['year'].max())}")

    if save and not df.empty:
        save_data(df, "wgi", PROCESSED_DIR)

    return df


if __name__ == "__main__":
    from .utils import configure_logging
    configure_logging()
    fetch_wgi()
