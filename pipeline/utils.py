"""
utils.py — Shared utility functions for the Health Financing Dashboard pipeline.

Handles:
  - Country code standardisation (all sources normalised to ISO 3166-1 alpha-3)
  - Data frame standardisation to a consistent long format
  - File saving (Parquet + CSV) with atomic writes
  - Data quality validation
  - Logging helpers
"""

from __future__ import annotations

import csv
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime
from pathlib import Path
from typing import Callable, TypeVar

import pandas as pd
import pycountry

logger = logging.getLogger(__name__)

T = TypeVar("T")

# ─────────────────────────────────────────────
# COUNTRY CODE MAPPINGS
# ─────────────────────────────────────────────

WB_TO_ISO3: dict[str, str] = {
    "XKX": "XKX",  # Kosovo
    "PSE": "PSE",  # West Bank and Gaza
    "TWN": "TWN",  # Taiwan
    "CHI": "CHI",  # Channel Islands
    "IMY": "IMN",  # Isle of Man
    "KSV": "XKX",  # Kosovo (World Bank code)
}

IMF_TO_ISO3: dict[str, str] = {
    "AFG": "AFG", "ALB": "ALB", "DZA": "DZA", "AGO": "AGO", "ARG": "ARG",
    "ARM": "ARM", "AUS": "AUS", "AUT": "AUT", "AZE": "AZE", "BHS": "BHS",
    "BHR": "BHR", "BGD": "BGD", "BLR": "BLR", "BEL": "BEL", "BLZ": "BLZ",
    "BEN": "BEN", "BTN": "BTN", "BOL": "BOL", "BIH": "BIH", "BWA": "BWA",
    "BRA": "BRA", "BRN": "BRN", "BGR": "BGR", "BFA": "BFA", "BDI": "BDI",
    "CPV": "CPV", "KHM": "KHM", "CMR": "CMR", "CAN": "CAN", "CAF": "CAF",
    "TCD": "TCD", "CHL": "CHL", "CHN": "CHN", "COL": "COL", "COM": "COM",
    "COD": "COD", "COG": "COG", "CRI": "CRI", "CIV": "CIV", "HRV": "HRV",
    "CYP": "CYP", "CZE": "CZE", "DNK": "DNK", "DJI": "DJI", "DOM": "DOM",
    "ECU": "ECU", "EGY": "EGY", "SLV": "SLV", "GNQ": "GNQ", "ERI": "ERI",
    "EST": "EST", "SWZ": "SWZ", "ETH": "ETH", "FJI": "FJI", "FIN": "FIN",
    "FRA": "FRA", "GAB": "GAB", "GMB": "GMB", "GEO": "GEO", "DEU": "DEU",
    "GHA": "GHA", "GRC": "GRC", "GTM": "GTM", "GIN": "GIN", "GNB": "GNB",
    "GUY": "GUY", "HTI": "HTI", "HND": "HND", "HUN": "HUN", "ISL": "ISL",
    "IND": "IND", "IDN": "IDN", "IRN": "IRN", "IRQ": "IRQ", "IRL": "IRL",
    "ISR": "ISR", "ITA": "ITA", "JAM": "JAM", "JPN": "JPN", "JOR": "JOR",
    "KAZ": "KAZ", "KEN": "KEN", "KIR": "KIR", "PRK": "PRK", "KOR": "KOR",
    "KWT": "KWT", "KGZ": "KGZ", "LAO": "LAO", "LVA": "LVA", "LBN": "LBN",
    "LSO": "LSO", "LBR": "LBR", "LBY": "LBY", "LTU": "LTU", "LUX": "LUX",
    "MDG": "MDG", "MWI": "MWI", "MYS": "MYS", "MDV": "MDV", "MLI": "MLI",
    "MLT": "MLT", "MRT": "MRT", "MUS": "MUS", "MEX": "MEX", "MDA": "MDA",
    "MNG": "MNG", "MNE": "MNE", "MAR": "MAR", "MOZ": "MOZ", "MMR": "MMR",
    "NAM": "NAM", "NPL": "NPL", "NLD": "NLD", "NZL": "NZL", "NIC": "NIC",
    "NER": "NER", "NGA": "NGA", "MKD": "MKD", "NOR": "NOR", "OMN": "OMN",
    "PAK": "PAK", "PAN": "PAN", "PNG": "PNG", "PRY": "PRY", "PER": "PER",
    "PHL": "PHL", "POL": "POL", "PRT": "PRT", "QAT": "QAT", "ROU": "ROU",
    "RUS": "RUS", "RWA": "RWA", "WSM": "WSM", "STP": "STP", "SAU": "SAU",
    "SEN": "SEN", "SRB": "SRB", "SLE": "SLE", "SGP": "SGP", "SVK": "SVK",
    "SVN": "SVN", "SLB": "SLB", "SOM": "SOM", "ZAF": "ZAF", "SSD": "SSD",
    "ESP": "ESP", "LKA": "LKA", "SDN": "SDN", "SUR": "SUR", "SWE": "SWE",
    "CHE": "CHE", "SYR": "SYR", "TWN": "TWN", "TJK": "TJK", "TZA": "TZA",
    "THA": "THA", "TLS": "TLS", "TGO": "TGO", "TON": "TON", "TTO": "TTO",
    "TUN": "TUN", "TUR": "TUR", "TKM": "TKM", "UGA": "UGA", "UKR": "UKR",
    "ARE": "ARE", "GBR": "GBR", "USA": "USA", "URY": "URY", "UZB": "UZB",
    "VUT": "VUT", "VEN": "VEN", "VNM": "VNM", "YEM": "YEM", "ZMB": "ZMB",
    "ZWE": "ZWE", "KSV": "XKX",  # Kosovo
}


def iso3_from_name(name: str) -> str | None:
    """Try to get ISO3 code from a country name string using pycountry."""
    try:
        result = pycountry.countries.search_fuzzy(name)
        if result:
            return result[0].alpha_3
    except Exception:
        pass
    return None


def standardise_iso3(code: str, source_map: dict[str, str] | None = None) -> str:
    """
    Standardise a country code to ISO 3166-1 alpha-3.
    Falls back to the original code if no mapping is found.
    """
    if source_map and code in source_map:
        return source_map[code]
    try:
        country = pycountry.countries.get(alpha_3=code)
        if country:
            return country.alpha_3
    except Exception:
        pass
    return code


def get_country_name(iso3: str) -> str:
    """Get the English country name from an ISO3 code."""
    try:
        country = pycountry.countries.get(alpha_3=iso3)
        if country:
            return country.name
    except Exception:
        pass
    return iso3


# ─────────────────────────────────────────────
# STANDARD DATA FORMAT
# All pipeline modules output a DataFrame in this format:
#
#   iso3          | str   | ISO 3166-1 alpha-3 country code
#   country_name  | str   | English country name
#   year          | int   | 4-digit year
#   indicator_code| str   | Source indicator code
#   indicator_name| str   | Human-readable indicator name
#   value         | float | Numeric value
#   source        | str   | Data source label (e.g. "World Bank")
#   pulled_at     | str   | UTC timestamp when data was fetched
# ─────────────────────────────────────────────

STANDARD_COLUMNS: list[str] = [
    "iso3", "country_name", "year",
    "indicator_code", "indicator_name",
    "value", "source", "pulled_at",
]


def make_standard_df(records: list[dict]) -> pd.DataFrame:
    """
    Convert a list of record dicts into the standard long-format DataFrame.
    Casts dtypes, drops null key fields, deduplicates, and sorts.
    """
    df = pd.DataFrame(records, columns=STANDARD_COLUMNS)
    df["year"]  = pd.to_numeric(df["year"],  errors="coerce").astype("Int64")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["iso3", "year", "value"])
    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)
    return df


def cast_master_dtypes(df: pd.DataFrame) -> pd.DataFrame:
    """
    Apply memory-efficient dtypes to the master DataFrame before saving.
    Reduces file size and improves query performance in the dashboard.
    """
    df = df.copy()
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df["year"]  = pd.to_numeric(df["year"],  errors="coerce").astype("Int64")
    # Category columns save ~60% memory for low-cardinality string fields
    for col in ("iso3", "indicator_code", "indicator_name", "source"):
        if col in df.columns:
            df[col] = df[col].astype("category")
    return df


def now_utc() -> str:
    """Current UTC timestamp as a string."""
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")


# ─────────────────────────────────────────────
# DATA QUALITY VALIDATION
# ─────────────────────────────────────────────

class DataQualityError(ValueError):
    """Raised when a critical data quality check fails."""


def validate_standard_df(df: pd.DataFrame, source: str) -> None:
    """
    Run data quality checks on a standard-format DataFrame.
    Logs warnings for non-critical issues; raises DataQualityError for critical ones.

    Checks:
      - All required columns present
      - iso3 codes are exactly 3 characters
      - years are within the expected pipeline range
      - value null rate is below 50%
      - no duplicate (iso3, year, indicator_code) combinations
    """
    from .config import END_YEAR, START_YEAR

    # 1. Required columns
    missing_cols = set(STANDARD_COLUMNS) - set(df.columns)
    if missing_cols:
        raise DataQualityError(f"[{source}] Missing columns: {missing_cols}")

    if df.empty:
        logger.warning("[%s] DataFrame is empty — skipping further checks.", source)
        return

    # 2. ISO3 format
    bad_iso3 = df[df["iso3"].astype(str).str.len() != 3]
    if not bad_iso3.empty:
        codes = bad_iso3["iso3"].unique()[:5]
        raise DataQualityError(
            f"[{source}] {len(bad_iso3)} rows have non-3-char iso3 codes: {codes}"
        )

    # 3. Year range
    year_series = pd.to_numeric(df["year"], errors="coerce")
    out_of_range = df[~year_series.between(START_YEAR, END_YEAR)]
    if not out_of_range.empty:
        logger.warning(
            "[%s] %d rows have years outside %d–%d: %s",
            source, len(out_of_range), START_YEAR, END_YEAR,
            sorted(out_of_range["year"].unique())[:5],
        )

    # 4. Null rate
    null_rate = df["value"].isna().mean()
    if null_rate > 0.5:
        raise DataQualityError(
            f"[{source}] value column is {null_rate:.1%} null — likely a parse failure"
        )
    if null_rate > 0.1:
        logger.warning("[%s] value column is %.1f%% null.", source, null_rate * 100)

    # 5. Duplicates
    dups = df.duplicated(subset=["iso3", "year", "indicator_code"]).sum()
    if dups > 0:
        logger.warning(
            "[%s] %d duplicate (iso3, year, indicator_code) rows — will be dropped on merge.",
            source, dups,
        )

    logger.debug("[%s] Quality checks passed. %d rows, %d indicators.", source, len(df), df["indicator_code"].nunique())


# ─────────────────────────────────────────────
# SKIP LOG
# ─────────────────────────────────────────────

_SKIP_LOG_COLUMNS: list[str] = [
    "logged_at",
    "source",
    "indicator_code",
    "indicator_name",
    "reason",
    "detail",
    "run_started_at",
]


def log_skip(
    source: str,
    indicator_code: str,
    indicator_name: str,
    reason: str,
    detail: str = "",
    run_started_at: str = "",
    logs_dir: str | None = None,
) -> None:
    """
    Append one row to logs/skipped_indicators.csv for a skipped indicator.
    Thread-safe for single-process use (appends one row at a time).

    Args:
        source:          Data source label (e.g. "World Bank").
        indicator_code:  The indicator code that was skipped.
        indicator_name:  Human-readable indicator name.
        reason:          Short reason tag: "timeout", "api_error", "no_data",
                         "http_404", "parse_error".
        detail:          Full error message or extra context (optional).
        run_started_at:  Timestamp of the overall pipeline run (optional).
        logs_dir:        Override the default logs directory.
    """
    from .config import LOGS_DIR as _default_logs_dir

    _logs_dir = logs_dir or _default_logs_dir
    os.makedirs(_logs_dir, exist_ok=True)
    log_path = os.path.join(_logs_dir, "skipped_indicators.csv")

    row = {
        "logged_at":      datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
        "source":         source,
        "indicator_code": indicator_code,
        "indicator_name": indicator_name,
        "reason":         reason,
        "detail":         str(detail)[:300],
        "run_started_at": run_started_at,
    }

    write_header = not os.path.exists(log_path)
    with open(log_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=_SKIP_LOG_COLUMNS)
        if write_header:
            writer.writeheader()
        writer.writerow(row)

    logger.debug("Skipped %s / %s — %s", source, indicator_code, reason)


def load_skip_log(logs_dir: str | None = None) -> pd.DataFrame:
    """Load the skipped indicators log. Returns empty DataFrame if none exists."""
    from .config import LOGS_DIR as _default_logs_dir

    _logs_dir = logs_dir or _default_logs_dir
    log_path = os.path.join(_logs_dir, "skipped_indicators.csv")
    if os.path.exists(log_path):
        return pd.read_csv(log_path)
    return pd.DataFrame(columns=_SKIP_LOG_COLUMNS)


# ─────────────────────────────────────────────
# RESILIENT FETCH  (timeout + retry with backoff, shared by source modules)
# ─────────────────────────────────────────────

def resilient_fetch(
    call: Callable[[], T],
    *,
    timeout: float = 120,
    max_retries: int = 3,
    backoff: float = 1.0,
    retry_on_timeout: bool = False,
    label: str = "",
) -> T:
    """
    Run ``call`` in a worker thread with a hard timeout, retrying transient
    failures with exponential backoff.

    Motivation: the World Bank / WGI APIs intermittently return malformed JSON
    ("JSON decoding error"). Without retries, a single transient blip
    permanently drops an indicator for the whole run. This helper gives those
    fetchers the same resilience the IMF session already has via urllib3 Retry.

    Retry policy:
      - Any exception whose message contains "404" is treated as a permanent
        not-found and re-raised immediately (no retry).
      - Other exceptions are retried up to ``max_retries`` times, sleeping
        ``backoff * attempt`` seconds between tries.
      - Timeouts are only retried when ``retry_on_timeout=True`` (off by
        default, since the per-attempt timeout is already long).

    On failure the original exception is re-raised (``FuturesTimeoutError`` for
    a timeout), so callers can classify and ``log_skip`` exactly as before.
    """
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(call)
            try:
                return future.result(timeout=timeout)
            except FuturesTimeoutError:
                if retry_on_timeout and attempt < max_retries:
                    logger.warning(
                        "%s timed out (attempt %d/%d) — retrying",
                        label, attempt, max_retries,
                    )
                    time.sleep(backoff * attempt)
                    continue
                raise
            except Exception as exc:
                last_exc = exc
                if "404" in str(exc) or attempt >= max_retries:
                    raise
                logger.warning(
                    "%s transient error (attempt %d/%d): %s — retrying",
                    label, attempt, max_retries, exc,
                )
                time.sleep(backoff * attempt)
    # Defensive: loop always returns or raises, but satisfy type-checkers.
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("resilient_fetch exhausted retries without an exception")


# ─────────────────────────────────────────────
# FILE SAVING  (atomic writes to prevent corrupt cache on crash)
# ─────────────────────────────────────────────

def _atomic_parquet_write(df: pd.DataFrame, dest: Path) -> None:
    """
    Write a DataFrame to Parquet atomically via a .tmp file.
    Uses zstd compression for a better size/speed trade-off than snappy.
    Prevents partial/corrupt files if the process is killed mid-write.
    """
    tmp = dest.with_suffix(".tmp.parquet")
    try:
        df.to_parquet(tmp, index=False, compression="zstd")
        tmp.rename(dest)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def save_data(df: pd.DataFrame, name: str, processed_dir: str) -> None:
    """
    Save a processed pipeline DataFrame (long-format with value/year columns)
    as a zstd-compressed Parquet file.  Applies memory-efficient dtypes and
    uses atomic write to prevent corrupt files on crash.

    Use save_reference() instead for wide-format reference tables (e.g.
    country_metadata) that do not have value/year columns.

    Args:
        df:            The DataFrame to save.
        name:          File base name (e.g. "world_bank").
        processed_dir: Directory to save into.
    """
    os.makedirs(processed_dir, exist_ok=True)
    df = cast_master_dtypes(df)

    parquet_path = Path(processed_dir) / f"{name}.parquet"
    _atomic_parquet_write(df, parquet_path)

    rows       = len(df)
    countries  = df["iso3"].nunique() if "iso3" in df.columns else "?"
    indicators = df["indicator_code"].nunique() if "indicator_code" in df.columns else "?"

    logger.info(
        "Saved %s — %s rows | %s countries | %s indicators",
        name, f"{rows:,}", countries, indicators,
    )


def save_reference(df: pd.DataFrame, name: str, processed_dir: str) -> None:
    """
    Save a wide-format reference DataFrame (e.g. country_metadata) as
    zstd-compressed Parquet without applying pipeline-specific dtype coercions.
    Uses atomic write.

    Args:
        df:            The reference DataFrame to save.
        name:          File base name (e.g. "country_metadata").
        processed_dir: Directory to save into.
    """
    os.makedirs(processed_dir, exist_ok=True)
    parquet_path = Path(processed_dir) / f"{name}.parquet"
    _atomic_parquet_write(df, parquet_path)
    logger.info("Saved reference %s — %d rows | %d columns", name, len(df), len(df.columns))


def load_data(name: str, processed_dir: str) -> pd.DataFrame | None:
    """Load a previously saved Parquet file. Returns None if not found."""
    parquet_path = os.path.join(processed_dir, f"{name}.parquet")
    if os.path.exists(parquet_path):
        return pd.read_parquet(parquet_path)
    return None


def load_all_sources(processed_dir: str) -> pd.DataFrame:
    """
    Load and concatenate all saved source Parquet files into a master DataFrame.
    Selects only STANDARD_COLUMNS and casts dtypes before concatenating.
    """
    all_dfs: list[pd.DataFrame] = []
    # imf_projections holds forward WEO years (beyond END_YEAR) for scenario
    # charts only — it must never enter the actuals-only master panel.
    excluded = {"master.parquet", "country_metadata.parquet", "imf_projections.parquet"}
    # Analytical marts are wide reference tables, not long-format source data
    mart_prefixes = ("mart_",)

    for fname in os.listdir(processed_dir):
        if fname.endswith(".parquet") and fname not in excluded and not fname.startswith(mart_prefixes):
            path = os.path.join(processed_dir, fname)
            try:
                df = pd.read_parquet(path)
                # Only keep standard columns to prevent schema mismatches
                df = df[[c for c in STANDARD_COLUMNS if c in df.columns]]
                all_dfs.append(df)
            except Exception as exc:
                logger.warning("Could not read %s: %s", fname, exc)

    if not all_dfs:
        logger.warning("No data files found in %s", processed_dir)
        return pd.DataFrame(columns=STANDARD_COLUMNS)

    master = pd.concat(all_dfs, ignore_index=True)

    n_before = len(master)
    master = master.drop_duplicates(subset=["iso3", "year", "indicator_code", "source"])
    n_dropped = n_before - len(master)
    if n_dropped:
        logger.warning(
            "Dropped %d duplicate rows during master aggregation.", n_dropped
        )

    master = cast_master_dtypes(master)
    return master.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)


# ─────────────────────────────────────────────
# CACHE HELPERS  (shared by all source modules)
# ─────────────────────────────────────────────

def cache_is_fresh(path: str | Path, max_age_days: int = 30) -> bool:
    """
    Return True if a cache file exists and was written within max_age_days.
    Enables incremental refreshes without manually deleting cache files.
    Uses raw timestamps to avoid local-vs-UTC timezone issues.
    """
    import time

    p = Path(path)
    if not p.exists():
        return False
    if max_age_days <= 0:
        return False
    age_seconds = time.time() - p.stat().st_mtime
    return age_seconds < max_age_days * 86400


def configure_logging(level: int = logging.INFO) -> None:
    """
    Set up project-wide logging with a consistent format.
    Call once from run_pipeline.py or notebooks before running the pipeline.
    """
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
