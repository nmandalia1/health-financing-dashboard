"""
who_gho.py — Pull data from the WHO Global Health Observatory (GHO).

Source:   WHO Global Health Observatory (https://www.who.int/data/gho)
API:      OData REST API — free, no authentication required
Base URL: https://ghoapi.azureedge.net/api/
Coverage: 245 countries and territories, various years
License:  CC-BY 3.0 IGO
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from tqdm import tqdm
from urllib3.util.retry import Retry

from .config import END_YEAR, PROCESSED_DIR, RAW_DIR, START_YEAR, WHO_GHO_INDICATORS
from .utils import (
    cache_is_fresh,
    get_country_name,
    log_skip,
    make_standard_df,
    now_utc,
    save_data,
    validate_standard_df,
)

logger = logging.getLogger(__name__)

GHO_BASE_URL    = "https://ghoapi.azureedge.net/api"
REQUEST_TIMEOUT = 30
CACHE_MAX_AGE_DAYS = 30
# Max concurrent indicator fetches — stay polite to the WHO API
MAX_WORKERS = 5

GHO_CACHE_DIR = Path(RAW_DIR) / "who_gho"


def _build_session() -> requests.Session:
    """
    Build a requests.Session with connection pooling and automatic retries
    on transient network errors (500, 502, 503, 504).
    """
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=1.0,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods={"GET"},
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=20)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


# Module-level shared session — reuses TCP connections across all indicator fetches
_SESSION: requests.Session = _build_session()


def _cache_path(code: str) -> Path:
    safe = code.replace("/", "_").replace(".", "_")
    return GHO_CACHE_DIR / f"{safe}.parquet"


def _load_cached(code: str, max_age_days: int = CACHE_MAX_AGE_DAYS) -> pd.DataFrame | None:
    path = _cache_path(code)
    if cache_is_fresh(path, max_age_days):
        return pd.read_parquet(path)
    return None


def _save_cached(code: str, df: pd.DataFrame) -> None:
    GHO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    df.to_parquet(_cache_path(code), index=False, compression="zstd")


def _fetch_gho_indicator(
    code: str,
    start_year: int,
    end_year: int,
    session: requests.Session | None = None,
) -> list[dict]:
    """
    Fetch all country-level records for a single GHO indicator.
    Follows @odata.nextLink pagination (GHO API max page size is 1000).
    """
    s = session or _SESSION
    odata_filter = (
        f"SpatialDimType eq 'COUNTRY' "
        f"and TimeDimType eq 'YEAR' "
        f"and TimeDim ge {start_year} "
        f"and TimeDim le {end_year}"
    )

    url: str | None = f"{GHO_BASE_URL}/{code}"
    params: dict | None = {
        "$filter": odata_filter,
        "$select": "SpatialDim,TimeDim,NumericValue,Value,Dim1,Dim2",
        "$top": 1000,
    }

    all_records: list[dict] = []
    while url:
        response = s.get(url, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        all_records.extend(data.get("value", []))
        url    = data.get("@odata.nextLink")
        params = None  # params are embedded in nextLink

    return all_records


def _pick_best_value(records: list[dict]) -> list[dict]:
    """
    GHO data often has multiple rows per (country, year) due to sex/age
    disaggregation. Prefers rows where Dim1 is None or 'BTSX' (both sexes).
    Returns one record per (country, year).
    """
    df = pd.DataFrame(records)
    if df.empty:
        return []

    df = df.rename(columns={
        "SpatialDim":   "iso3",
        "TimeDim":      "year",
        "NumericValue": "numeric_value",
        "Value":        "string_value",
        "Dim1":         "dim1",
        "Dim2":         "dim2",
    })

    total_mask = df["dim1"].isna() | df["dim1"].isin(["BTSX", "TOTL", "TOT", ""])
    df_total   = df[total_mask]

    working = df_total if not df_total.empty else df
    working = working.dropna(subset=["numeric_value"])
    working = working.sort_values("year").drop_duplicates(subset=["iso3", "year"], keep="last")
    return working.to_dict("records")


def _fetch_and_process(
    code: str,
    name: str,
    start_year: int,
    end_year: int,
    pulled_at: str,
) -> pd.DataFrame | None:
    """
    Fetch, pick best values, and build a standard DataFrame for one indicator.
    Returns None and logs the skip if the fetch fails or yields no data.
    Designed to be called from a thread pool.
    """
    try:
        raw_records = _fetch_gho_indicator(code, start_year, end_year)
    except requests.exceptions.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            log_skip("WHO GHO", code, name, "http_404",
                     "Indicator not found on GHO API", pulled_at)
            logger.debug("WHO GHO 404: %s", code)
        else:
            log_skip("WHO GHO", code, name, "api_error", str(exc), pulled_at)
            logger.warning("WHO GHO HTTP error for %s: %s", code, exc)
        return None
    except Exception as exc:
        log_skip("WHO GHO", code, name, "api_error", str(exc), pulled_at)
        logger.warning("WHO GHO error for %s: %s", code, exc)
        return None

    if not raw_records:
        log_skip("WHO GHO", code, name, "no_data", "API returned 0 rows", pulled_at)
        return None

    best = _pick_best_value(raw_records)
    records: list[dict] = []
    for row in best:
        iso3  = str(row.get("iso3", "")).strip()
        year  = row.get("year")
        value = row.get("numeric_value")
        # Drop malformed codes (e.g. "SDN736") that slip through the API filter
        if not iso3 or len(iso3) != 3 or year is None or value is None:
            continue
        try:
            value = float(value)
        except (TypeError, ValueError):
            continue
        records.append({
            "iso3":           iso3,
            "country_name":   get_country_name(iso3),
            "year":           int(year),
            "indicator_code": code,
            "indicator_name": name,
            "value":          value,
            "source":         "WHO GHO",
            "pulled_at":      pulled_at,
        })

    if not records:
        log_skip("WHO GHO", code, name, "no_data",
                 "All rows filtered after processing", pulled_at)
        return None

    return make_standard_df(records)


def fetch_who_gho(
    indicators: dict[str, str] | None = None,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    save: bool = True,
    cache_max_age_days: int = CACHE_MAX_AGE_DAYS,
    max_workers: int = MAX_WORKERS,
) -> pd.DataFrame:
    """
    Fetch WHO GHO indicators for all countries in parallel.

    Indicators are fetched concurrently (up to max_workers at a time) using a
    thread pool, reducing wall-clock time significantly vs. serial fetching.
    Each indicator is cached individually; cached indicators are skipped.
    Cache files older than cache_max_age_days are automatically re-fetched.

    Args:
        indicators:         Dict of {code: name}. Defaults to config.WHO_GHO_INDICATORS.
        start_year:         First year to include.
        end_year:           Last year to include.
        save:               If True, save results to processed/ directory.
        cache_max_age_days: Re-fetch cached indicators older than this many days.
        max_workers:        Max concurrent HTTP fetches (default 5).

    Returns:
        Standardised long-format DataFrame.
    """
    if indicators is None:
        indicators = WHO_GHO_INDICATORS

    pulled_at    = now_utc()
    codes        = list(indicators.keys())
    cached_count = sum(1 for c in codes if _load_cached(c, cache_max_age_days) is not None)

    logger.info(
        "WHO GHO: %d indicators (%d cached, %d to fetch) | %d–%d",
        len(codes), cached_count, len(codes) - cached_count, start_year, end_year,
    )

    all_dfs: list[pd.DataFrame] = []
    to_fetch: list[tuple[str, str]] = []

    for code in codes:
        cached = _load_cached(code, cache_max_age_days)
        if cached is not None:
            all_dfs.append(cached)
        else:
            to_fetch.append((code, indicators[code]))

    # Parallel fetch for uncached indicators
    if to_fetch:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(
                    _fetch_and_process, code, name, start_year, end_year, pulled_at
                ): code
                for code, name in to_fetch
            }
            for future in tqdm(
                as_completed(futures),
                total=len(futures),
                desc="WHO GHO",
            ):
                code = futures[future]
                try:
                    ind_df = future.result()
                except Exception as exc:
                    logger.error("Unexpected error fetching %s: %s", code, exc)
                    ind_df = None

                if ind_df is not None:
                    _save_cached(code, ind_df)
                    all_dfs.append(ind_df)

    if not all_dfs:
        logger.warning("WHO GHO: no data retrieved.")
        return pd.DataFrame()

    df = pd.concat(all_dfs, ignore_index=True)
    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    validate_standard_df(df, "WHO GHO")

    logger.info(
        "WHO GHO complete: %d rows | %d countries | %d indicators",
        len(df), df["iso3"].nunique(), df["indicator_code"].nunique(),
    )

    if save and not df.empty:
        save_data(df, "who_gho", PROCESSED_DIR)

    return df


def list_gho_indicators(search_term: str = "") -> pd.DataFrame:
    """
    Fetch the full list of available GHO indicators.
    Optionally filter by a search term in the indicator name.
    """
    url = f"{GHO_BASE_URL}/Indicator"
    response = _SESSION.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    raw = response.json().get("value", [])
    df  = pd.DataFrame(raw)[["IndicatorCode", "IndicatorName"]]
    df.columns = ["code", "name"]

    if search_term:
        df = df[df["name"].str.contains(search_term, case=False, na=False)]

    return df.reset_index(drop=True)
