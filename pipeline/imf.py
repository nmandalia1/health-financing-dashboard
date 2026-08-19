"""
imf.py — Pull macroeconomic data from the IMF DataMapper API.

Source:   International Monetary Fund (https://www.imf.org/en/Publications/WEO)
API:      IMF DataMapper REST API — free, no authentication required
Base URL: https://www.imf.org/external/datamapper/api/v1/
Coverage: 190+ IMF member countries, 1980–2029 (incl. projections)
License:  IMF Terms and Conditions (free for non-commercial use)

Note: The DataMapper API returns both historical data and forward projections.
      This pipeline filters to historical data only (year <= END_YEAR).
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from tqdm import tqdm
from urllib3.util.retry import Retry

from .config import END_YEAR, IMF_BASE_URL, IMF_INDICATORS, PROCESSED_DIR, RAW_DIR, START_YEAR
from .utils import (
    IMF_TO_ISO3,
    cache_is_fresh,
    get_country_name,
    log_skip,
    make_standard_df,
    now_utc,
    save_data,
    validate_standard_df,
)

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT    = 30
CACHE_MAX_AGE_DAYS = 30
IMF_CACHE_DIR      = Path(RAW_DIR) / "imf"


def _build_session() -> requests.Session:
    """Shared session with connection pooling and retry logic."""
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=1.0,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods={"GET"},
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=5, pool_maxsize=10)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


_SESSION: requests.Session = _build_session()


def _cache_path(code: str) -> Path:
    return IMF_CACHE_DIR / f"{code}.parquet"


def _load_cached(code: str, max_age_days: int = CACHE_MAX_AGE_DAYS) -> pd.DataFrame | None:
    path = _cache_path(code)
    if cache_is_fresh(path, max_age_days):
        return pd.read_parquet(path)
    return None


def _save_cached(code: str, df: pd.DataFrame) -> None:
    IMF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    df.to_parquet(_cache_path(code), index=False, compression="zstd")


def _fetch_imf_indicator(code: str) -> dict:
    """
    Fetch all country/year data for a single IMF indicator.
    Returns: {imf_country_code: {year_str: value, ...}, ...}
    """
    url = f"{IMF_BASE_URL}/{code}"
    response = _SESSION.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    values = data.get("values", {})
    return values.get(code, {})


def fetch_imf(
    indicators: dict[str, str] | None = None,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    projection_end_year: int | None = None,
    save: bool = True,
    cache_max_age_days: int = CACHE_MAX_AGE_DAYS,
) -> pd.DataFrame:
    """
    Fetch IMF macroeconomic indicators for all countries.

    Cache files older than cache_max_age_days are automatically re-fetched,
    picking up revised IMF projections and historical revisions.

    Historical actuals (year <= end_year) are returned and saved to imf.parquet.
    When ``projection_end_year`` is set, forward projection years
    (end_year < year <= projection_end_year) are tagged with the source label
    "IMF WEO (projection)" and saved separately to imf_projections.parquet —
    keeping the master panel actuals-only while feeding the scenario charts.

    Args:
        indicators:          Dict of {code: name}. Defaults to config.IMF_INDICATORS.
        start_year:          First year to include.
        end_year:            Last historical (actuals) year.
        projection_end_year: If set, also capture projection years up to here.
        save:                If True, save results to processed/ directory.
        cache_max_age_days:  Re-fetch cached indicators older than this many days.

    Returns:
        Standardised long-format DataFrame of historical actuals only.
    """
    if indicators is None:
        indicators = IMF_INDICATORS

    need_projections = projection_end_year is not None
    effective_max    = projection_end_year if need_projections else end_year

    pulled_at    = now_utc()
    codes        = list(indicators.keys())
    cached_count = sum(1 for c in codes if _load_cached(c, cache_max_age_days) is not None)

    logger.info(
        "IMF: %d indicators (%d cached, %d to fetch) | %d–%d%s",
        len(codes), cached_count, len(codes) - cached_count, start_year, end_year,
        f" (+projections to {projection_end_year})" if need_projections else "",
    )

    all_dfs: list[pd.DataFrame] = []

    for code in tqdm(codes, desc="IMF"):
        name   = indicators[code]
        cached = _load_cached(code, cache_max_age_days)
        # A historical-only cache is insufficient when projections are wanted;
        # re-fetch so the forward years are populated.
        cache_ok = cached is not None and (
            not need_projections or int(cached["year"].max()) >= effective_max
        )
        if cache_ok:
            all_dfs.append(cached)
            continue

        try:
            country_data = _fetch_imf_indicator(code)
        except requests.exceptions.HTTPError as exc:
            err    = str(exc)
            reason = "http_404" if "404" in err else "api_error"
            log_skip("IMF", code, name, reason, err, pulled_at)
            logger.warning("IMF HTTP error for %s: %s", code, exc)
            continue
        except Exception as exc:
            log_skip("IMF", code, name, "api_error", str(exc), pulled_at)
            logger.warning("IMF error for %s: %s", code, exc)
            continue

        if not country_data:
            log_skip("IMF", code, name, "no_data", "API returned empty dataset", pulled_at)
            continue

        records: list[dict] = []
        for imf_code, country_info in country_data.items():
            iso3 = IMF_TO_ISO3.get(imf_code, imf_code)
            if not iso3.isalpha() or len(iso3) != 3:
                continue

            periods: dict = country_info if isinstance(country_info, dict) else {}
            for year_str, value in periods.items():
                try:
                    year = int(year_str)
                except ValueError:
                    continue
                if year < start_year or year > effective_max:
                    continue
                if value is None:
                    continue
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    continue

                records.append({
                    "iso3":           iso3,
                    "country_name":   get_country_name(iso3),
                    "year":           year,
                    "indicator_code": code,
                    "indicator_name": name,
                    "value":          value,
                    "source":         "IMF WEO (projection)" if year > end_year else "IMF",
                    "pulled_at":      pulled_at,
                })

        if records:
            ind_df = make_standard_df(records)
            _save_cached(code, ind_df)
            all_dfs.append(ind_df)
        else:
            log_skip("IMF", code, name, "no_data",
                     "All rows filtered after processing", pulled_at)

    if not all_dfs:
        logger.warning("IMF: no data retrieved.")
        return pd.DataFrame()

    df_all = pd.concat(all_dfs, ignore_index=True)
    df_all = df_all.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    # Split actuals from forward projections. Projections live in a separate
    # file so the master panel stays actuals-only (and within END_YEAR).
    is_proj = df_all["source"] == "IMF WEO (projection)"
    hist = df_all[~is_proj].reset_index(drop=True)
    proj = df_all[is_proj].reset_index(drop=True)

    validate_standard_df(hist, "IMF")

    logger.info(
        "IMF complete: %d historical rows + %d projection rows | %d countries | %d indicators",
        len(hist), len(proj), hist["iso3"].nunique(), hist["indicator_code"].nunique(),
    )

    if save:
        if not hist.empty:
            save_data(hist, "imf", PROCESSED_DIR)
        if need_projections and not proj.empty:
            save_data(proj, "imf_projections", PROCESSED_DIR)

    return hist


def list_imf_indicators() -> pd.DataFrame:
    """Fetch the full list of available IMF DataMapper indicators."""
    url      = f"{IMF_BASE_URL}/indicators"
    response = _SESSION.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    raw = response.json().get("indicators", {})
    records = [
        {
            "code":   code,
            "name":   info.get("label", ""),
            "unit":   info.get("unit", ""),
            "source": info.get("source", ""),
        }
        for code, info in raw.items()
    ]
    return pd.DataFrame(records).sort_values("code").reset_index(drop=True)
