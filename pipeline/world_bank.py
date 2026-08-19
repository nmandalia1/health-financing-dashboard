"""
world_bank.py — Pull World Bank Health, Nutrition & Population + macro data.

Source:   World Bank Open Data (https://data.worldbank.org/)
API:      wbgapi Python package (free, no authentication required)
Coverage: 247 countries and territories, 2000–2023
License:  CC-BY 4.0
"""

from __future__ import annotations

import logging
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path

import pandas as pd
import wbgapi as wb
from tqdm import tqdm

from .config import END_YEAR, PROCESSED_DIR, RAW_DIR, START_YEAR, WORLD_BANK_INDICATORS
from .utils import (
    cache_is_fresh,
    get_country_name,
    log_skip,
    make_standard_df,
    now_utc,
    resilient_fetch,
    save_data,
    validate_standard_df,
)

logger = logging.getLogger(__name__)

WB_CACHE_DIR = Path(RAW_DIR) / "world_bank"
# How old a cache file can be before it is considered stale and re-fetched
CACHE_MAX_AGE_DAYS = 30


def _cache_path(code: str) -> Path:
    safe = code.replace(".", "_")
    return WB_CACHE_DIR / f"{safe}.parquet"


def _load_cached(code: str, max_age_days: int = CACHE_MAX_AGE_DAYS) -> pd.DataFrame | None:
    """Return cached DataFrame if it exists and is fresh, else None."""
    path = _cache_path(code)
    if cache_is_fresh(path, max_age_days):
        return pd.read_parquet(path)
    return None


def _save_cached(code: str, df: pd.DataFrame) -> None:
    WB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    df.to_parquet(_cache_path(code), index=False, compression="zstd")


def _fetch_one_indicator(
    code: str,
    name: str,
    start_year: int,
    end_year: int,
    pulled_at: str,
) -> pd.DataFrame | None:
    """
    Fetch a single World Bank indicator for all countries.
    Returns a standard-format DataFrame, or None on failure (logged internally).
    Runs in a worker thread with a hard timeout and retries transient API
    errors (e.g. intermittent malformed-JSON responses) with backoff.
    """
    def _call() -> pd.DataFrame:
        raw = wb.data.DataFrame(
            code,
            time=range(start_year, end_year + 1),
            labels=False,
            numericTimeKeys=True,
        )
        return raw

    try:
        raw = resilient_fetch(
            _call, timeout=120, max_retries=3, backoff=1.0, label=f"World Bank/{code}",
        )
    except FuturesTimeoutError:
        log_skip("World Bank", code, name, "timeout",
                 "No response within 120s", pulled_at)
        logger.warning("World Bank timeout: %s", code)
        return None
    except Exception as exc:
        err = str(exc)
        reason = "http_404" if "404" in err else "api_error"
        log_skip("World Bank", code, name, reason,
                 f"after retries: {err}", pulled_at)
        logger.warning("World Bank error for %s: %s", code, err)
        return None

    raw = raw.reset_index()
    id_col = raw.columns[0]
    melted = raw.melt(id_vars=[id_col], var_name="year", value_name="value")
    melted = melted.rename(columns={id_col: "iso3"})
    melted = melted.dropna(subset=["value"])

    # Drop World Bank aggregate / region codes (contain digits or aren't 3-char)
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
            "source":         "World Bank",
            "pulled_at":      pulled_at,
        }
        for _, row in melted.iterrows()
    ]

    if not records:
        log_skip("World Bank", code, name, "no_data",
                 "API returned 0 rows for this indicator", pulled_at)
        return None

    return make_standard_df(records)


def fetch_world_bank(
    indicators: dict[str, str] | None = None,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    save: bool = True,
    cache_max_age_days: int = CACHE_MAX_AGE_DAYS,
) -> pd.DataFrame:
    """
    Fetch World Bank indicators for all countries and return a
    standardised long-format DataFrame.

    Resumable: each indicator is cached to data/raw/world_bank/<code>.parquet.
    Cache files older than cache_max_age_days are re-fetched automatically.
    Delete data/raw/world_bank/ to force a full refresh.

    Args:
        indicators:         Dict of {code: name}. Defaults to config.WORLD_BANK_INDICATORS.
        start_year:         First year to fetch.
        end_year:           Last year to fetch.
        save:               If True, save results to processed/ directory.
        cache_max_age_days: Re-fetch cached indicators older than this many days.

    Returns:
        DataFrame with standard columns.
    """
    if indicators is None:
        indicators = WORLD_BANK_INDICATORS

    codes     = list(indicators.keys())
    pulled_at = now_utc()

    cached_count = sum(1 for c in codes if _load_cached(c, cache_max_age_days) is not None)
    logger.info(
        "World Bank: %d indicators (%d cached, %d to fetch) | %d–%d",
        len(codes), cached_count, len(codes) - cached_count, start_year, end_year,
    )

    all_dfs: list[pd.DataFrame] = []

    for code in tqdm(codes, desc="World Bank"):
        name = indicators[code]

        cached = _load_cached(code, cache_max_age_days)
        if cached is not None:
            all_dfs.append(cached)
            continue

        ind_df = _fetch_one_indicator(code, name, start_year, end_year, pulled_at)
        if ind_df is not None:
            _save_cached(code, ind_df)
            all_dfs.append(ind_df)

    if not all_dfs:
        logger.warning("World Bank: no data retrieved.")
        return pd.DataFrame()

    df = pd.concat(all_dfs, ignore_index=True)
    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    validate_standard_df(df, "World Bank")

    logger.info(
        "World Bank complete: %d rows | %d countries | %d indicators",
        len(df), df["iso3"].nunique(), df["indicator_code"].nunique(),
    )

    if save and not df.empty:
        save_data(df, "world_bank", PROCESSED_DIR)

    return df


def preview_world_bank(n_rows: int = 10) -> pd.DataFrame:
    """Quick preview: fetch 3 key indicators for 5 sample countries."""
    sample_indicators = {
        "SH.XPD.CHEX.GD.ZS": "Current health expenditure (% of GDP)",
        "SH.XPD.OOPC.CH.ZS":  "Out-of-pocket expenditure (% of CHE)",
        "NY.GDP.PCAP.CD":      "GDP per capita (current USD)",
    }
    sample_countries = ["GBR", "USA", "KEN", "IND", "BRA"]
    pulled_at = now_utc()
    records: list[dict] = []

    for code, name in sample_indicators.items():
        try:
            raw = wb.data.DataFrame(
                code,
                economy=sample_countries,
                time=range(2015, 2023),
                labels=False,
                numericTimeKeys=True,
            ).reset_index()
            id_col = raw.columns[0]
            melted = (
                raw.melt(id_vars=[id_col], var_name="year", value_name="value")
                   .rename(columns={id_col: "iso3"})
                   .dropna(subset=["value"])
            )
            for _, row in melted.iterrows():
                records.append({
                    "iso3":           row["iso3"],
                    "country_name":   get_country_name(str(row["iso3"])),
                    "year":           int(row["year"]),
                    "indicator_code": code,
                    "indicator_name": name,
                    "value":          float(row["value"]),
                    "source":         "World Bank",
                    "pulled_at":      pulled_at,
                })
        except Exception as exc:
            logger.warning("Preview fetch failed for %s: %s", code, exc)

    return make_standard_df(records).head(n_rows)
