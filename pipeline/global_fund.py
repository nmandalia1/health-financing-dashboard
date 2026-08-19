"""
global_fund.py — Pull grant and results data from The Global Fund.

Source:   The Global Fund to Fight AIDS, Tuberculosis and Malaria
API:      OData v4 REST API — free, no authentication required
Base URL: https://data-service.theglobalfund.org/v3.3/odata/
Coverage: All Global Fund-supported countries (100+ countries)
License:  Open data
Docs:     https://data-service.theglobalfund.org/

Datasets pulled:
  1. Grants           — funding by country, disease component, grant period
  2. Country Results  — programme results indicators by country and disease
"""

import os

import requests
import pandas as pd
from tqdm import tqdm

from .config import GLOBAL_FUND_BASE_URL, PROCESSED_DIR, RAW_DIR
from .utils  import get_country_name, iso3_from_name, save_data, now_utc, log_skip

REQUEST_TIMEOUT = 45
PAGE_SIZE = 1000  # OData pagination

# Response-level cache (Global Fund has 2 endpoints, not per-indicator)
GF_CACHE_DIR      = os.path.join(RAW_DIR, "global_fund")
GF_GRANTS_CACHE   = os.path.join(GF_CACHE_DIR, "grants_raw.parquet")
GF_RESULTS_CACHE  = os.path.join(GF_CACHE_DIR, "results_raw.parquet")


def _get_odata(endpoint: str, params: dict = None) -> list[dict]:
    """
    Fetch all pages from a Global Fund OData endpoint.
    Handles OData @odata.nextLink pagination automatically.
    """
    url = f"{GLOBAL_FUND_BASE_URL}/{endpoint}"
    base_params = {"$top": PAGE_SIZE}
    if params:
        base_params.update(params)

    all_records = []
    while url:
        response = requests.get(url, params=base_params if url == f"{GLOBAL_FUND_BASE_URL}/{endpoint}" else None,
                                timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        data    = response.json()
        records = data.get("value", [])
        all_records.extend(records)

        # OData pagination
        url = data.get("@odata.nextLink")
        base_params = None  # params are embedded in nextLink

    return all_records


def fetch_global_fund_grants(save: bool = True, use_cache: bool = True) -> pd.DataFrame:
    """
    Fetch Global Fund grant data: country, disease component,
    grant period, approved budget, and disbursements.

    Resumable: raw grant records are cached to data/raw/global_fund/grants_raw.parquet.
    Delete that file to force a re-fetch from the API.

    Returns a long-format DataFrame with one row per
    (country, disease, grant period) combination.
    """
    pulled_at = now_utc()

    print("\n  Fetching Global Fund grants...")

    # ── Load from cache if available ─────────────────────────
    if use_cache and os.path.exists(GF_GRANTS_CACHE):
        print("  ↩ Loading grants from cache (delete data/raw/global_fund/grants_raw.parquet to refresh)")
        cached_df = pd.read_parquet(GF_GRANTS_CACHE)
        print(f"  ✓ Grants loaded from cache: {len(cached_df):,} rows | {cached_df['iso3'].nunique()} countries")
        return cached_df

    try:
        params = {
            "$select": (
                "CountryName,CountryCode,ComponentName,"
                "PeriodStartYear,PeriodEndYear,"
                "ApprovedBudget,Disbursements,GrantAgreementStatusTypeName"
            ),
            "$filter": "GrantAgreementStatusTypeName ne 'Terminated'",
        }
        records = _get_odata("Grants", params)

    except Exception as e:
        print(f"  ✗ Failed to fetch grants: {e}")
        log_skip("Global Fund", "GF_GRANTS", "Global Fund grant data",
                 "api_error", str(e), now_utc())
        return pd.DataFrame()

    rows = []
    for r in records:
        country_name = r.get("CountryName", "")
        iso3 = r.get("CountryCode", "")

        # Global Fund uses ISO3 codes in CountryCode field
        if not iso3 or len(iso3) != 3:
            iso3 = iso3_from_name(country_name) or country_name

        period_start = r.get("PeriodStartYear")
        period_end   = r.get("PeriodEndYear")
        component    = r.get("ComponentName", "")
        budget       = r.get("ApprovedBudget")
        disbursed    = r.get("Disbursements")
        status       = r.get("GrantAgreementStatusTypeName", "")

        # Add approved budget row
        if budget is not None:
            try:
                rows.append({
                    "iso3":           iso3,
                    "country_name":   country_name or get_country_name(iso3),
                    "year":           int(period_start) if period_start else None,
                    "indicator_code": f"GF_BUDGET_{component.upper().replace(' ', '_')[:20]}",
                    "indicator_name": f"Global Fund approved budget — {component} (USD)",
                    "value":          float(budget),
                    "source":         "Global Fund",
                    "pulled_at":      pulled_at,
                    "period_end":     period_end,
                    "component":      component,
                    "status":         status,
                })
            except (TypeError, ValueError):
                pass

        # Add disbursement row
        if disbursed is not None:
            try:
                rows.append({
                    "iso3":           iso3,
                    "country_name":   country_name or get_country_name(iso3),
                    "year":           int(period_start) if period_start else None,
                    "indicator_code": f"GF_DISBURSED_{component.upper().replace(' ', '_')[:20]}",
                    "indicator_name": f"Global Fund disbursements — {component} (USD)",
                    "value":          float(disbursed),
                    "source":         "Global Fund",
                    "pulled_at":      pulled_at,
                    "period_end":     period_end,
                    "component":      component,
                    "status":         status,
                })
            except (TypeError, ValueError):
                pass

    df = pd.DataFrame(rows)
    df = df.dropna(subset=["iso3", "year", "value"])
    df["year"]  = df["year"].astype("Int64")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    # Multiple grants can share the same (iso3, year, indicator_code).
    # Sum them so no data is lost when the master deduplication runs.
    group_cols = ["iso3", "country_name", "year", "indicator_code",
                  "indicator_name", "source", "pulled_at"]
    df = (
        df.groupby(group_cols, as_index=False)["value"]
        .sum()
    )

    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    # Save to cache
    os.makedirs(GF_CACHE_DIR, exist_ok=True)
    df.to_parquet(GF_GRANTS_CACHE, index=False)

    print(f"  ✓ Grants fetched: {len(df):,} rows | {df['iso3'].nunique()} countries")
    return df


def fetch_global_fund_results(save: bool = True, use_cache: bool = True) -> pd.DataFrame:
    """
    Fetch Global Fund country-level results indicators.
    These are programmatic outcomes (e.g. ART coverage, bed nets distributed).

    Resumable: raw results are cached to data/raw/global_fund/results_raw.parquet.
    Delete that file to force a re-fetch from the API.

    Returns a long-format DataFrame.
    """
    pulled_at = now_utc()

    print("\n  Fetching Global Fund results indicators...")

    # ── Load from cache if available ─────────────────────────
    if use_cache and os.path.exists(GF_RESULTS_CACHE):
        print("  ↩ Loading results from cache (delete data/raw/global_fund/results_raw.parquet to refresh)")
        cached_df = pd.read_parquet(GF_RESULTS_CACHE)
        print(f"  ✓ Results loaded from cache: {len(cached_df):,} rows | {cached_df['iso3'].nunique()} countries")
        return cached_df

    try:
        params = {
            "$select": (
                "CountryName,CountryCode,ComponentName,"
                "IndicatorShortName,PeriodYear,"
                "AchievementValue,TargetValue"
            ),
            "$top": PAGE_SIZE,
        }
        records = _get_odata("ResultCountryIndicators", params)
    except Exception as e:
        print(f"  ✗ Failed to fetch results: {e}")
        log_skip("Global Fund", "GF_RESULTS", "Global Fund results indicators",
                 "api_error", str(e), now_utc())
        return pd.DataFrame()

    rows = []
    for r in records:
        country_name = r.get("CountryName", "")
        iso3         = r.get("CountryCode", "") or iso3_from_name(country_name) or ""
        component    = r.get("ComponentName", "")
        indicator    = r.get("IndicatorShortName", "")
        year         = r.get("PeriodYear")
        achievement  = r.get("AchievementValue")
        target       = r.get("TargetValue")

        if not iso3 or not year or not indicator:
            continue

        safe_code = f"GF_RESULT_{indicator[:30].upper().replace(' ', '_')}"

        # Achievement
        if achievement is not None:
            try:
                rows.append({
                    "iso3":           iso3,
                    "country_name":   country_name or get_country_name(iso3),
                    "year":           int(year),
                    "indicator_code": safe_code + "_ACH",
                    "indicator_name": f"GF Result — {indicator} [{component}] (achieved)",
                    "value":          float(achievement),
                    "source":         "Global Fund",
                    "pulled_at":      pulled_at,
                })
            except (TypeError, ValueError):
                pass

        # Target
        if target is not None:
            try:
                rows.append({
                    "iso3":           iso3,
                    "country_name":   country_name or get_country_name(iso3),
                    "year":           int(year),
                    "indicator_code": safe_code + "_TGT",
                    "indicator_name": f"GF Result — {indicator} [{component}] (target)",
                    "value":          float(target),
                    "source":         "Global Fund",
                    "pulled_at":      pulled_at,
                })
            except (TypeError, ValueError):
                pass

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df.dropna(subset=["iso3", "year", "value"])
    df["year"]  = df["year"].astype("Int64")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    # Save to cache
    os.makedirs(GF_CACHE_DIR, exist_ok=True)
    df.to_parquet(GF_RESULTS_CACHE, index=False)

    print(f"  ✓ Results fetched: {len(df):,} rows | {df['iso3'].nunique()} countries")
    return df


def fetch_global_fund(save: bool = True) -> pd.DataFrame:
    """
    Fetch all Global Fund data (grants + results) and combine.

    Args:
        save: If True, save results to processed/ directory.

    Returns:
        Combined standardised long-format DataFrame.
    """
    print(f"\n{'='*60}")
    print(f" GLOBAL FUND  —  Grants + Results data")
    print(f"{'='*60}")

    grants  = fetch_global_fund_grants(save=False, use_cache=True)
    results = fetch_global_fund_results(save=False, use_cache=True)

    frames = [f for f in [grants, results] if not f.empty]

    if not frames:
        print("  ✗ No Global Fund data retrieved.")
        return pd.DataFrame()

    # Ensure standard columns exist in both frames
    standard_cols = ["iso3", "country_name", "year", "indicator_code",
                     "indicator_name", "value", "source", "pulled_at"]

    combined_frames = []
    for f in frames:
        # Add missing standard columns
        for col in standard_cols:
            if col not in f.columns:
                f[col] = None
        combined_frames.append(f[standard_cols])

    df = pd.concat(combined_frames, ignore_index=True)

    print(f"\n  Total records: {len(df):,}")
    print(f"  Countries:     {df['iso3'].nunique()}")
    print(f"  Indicators:    {df['indicator_code'].nunique()}")

    if save and not df.empty:
        save_data(df, "global_fund", PROCESSED_DIR)

    return df
