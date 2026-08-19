"""
wuenic.py — WHO/UNICEF Estimates of National Immunization Coverage (WUENIC).

Source:   WHO Immunization Analysis and Insights
URL:      https://cdn.who.int/media/docs/default-source/immunization/wuenic_input_to_pdf.xlsx
Coverage: ~194 countries, 1997–latest, 16 antigens
License:  CC-BY-IGO 3.0

WUENIC is the canonical global source for national routine immunisation
coverage — the series that World Bank (SH.IMM.*) and WHO GHO (WHS8_110,
MCV2, PCV3, ROTAC) repackage. Pulling it directly gives the full antigen
set (BCG, DTP1/3, MCV1/2, HepB3/BD, Hib3, PCV3, Pol3, RotaC, IPV1/2,
RCV1, YFV, MenA) back to 1997.

The workbook has a single long-format sheet 'wuenic_master' with columns:
    Country, ISOCountryCode, Vaccine, Year, WUENIC, ...

We keep only the WUENIC point estimate (the official WHO/UNICEF figure).
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import (
    END_YEAR,
    PROCESSED_DIR,
    RAW_DIR,
    START_YEAR,
    WUENIC_INDICATORS,
    WUENIC_URL,
)
from .utils import (
    cache_is_fresh,
    get_country_name,
    make_standard_df,
    now_utc,
    save_data,
    validate_standard_df,
)

logger = logging.getLogger(__name__)

CACHE_MAX_AGE_DAYS = 90   # WUENIC is republished once a year (July)
REQUEST_TIMEOUT    = 120
WUENIC_CACHE_DIR   = Path(RAW_DIR) / "wuenic"
_RAW_EXCEL_PATH    = WUENIC_CACHE_DIR / "wuenic.xlsx"
_SHEET_NAME        = "wuenic_master"


def _build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=2.0,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods={"GET"},
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


_SESSION: requests.Session = _build_session()


def _download_excel(dest: Path) -> None:
    logger.info("Downloading WUENIC Excel from WHO CDN…")
    resp = _SESSION.get(WUENIC_URL, timeout=REQUEST_TIMEOUT, stream=True)
    resp.raise_for_status()

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.xlsx")
    try:
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=65_536):
                f.write(chunk)
        tmp.rename(dest)
        logger.info(
            "Downloaded: %s (%.1f MB)",
            dest.name, dest.stat().st_size / 1024 / 1024,
        )
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def fetch_wuenic(
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    save: bool = True,
    cache_max_age_days: int = CACHE_MAX_AGE_DAYS,
) -> pd.DataFrame:
    """
    Load the WUENIC workbook, emit one row per (country, year, antigen),
    and return a standard long-format DataFrame.
    """
    if not cache_is_fresh(_RAW_EXCEL_PATH, cache_max_age_days):
        _download_excel(_RAW_EXCEL_PATH)
    else:
        logger.info("WUENIC: using cached Excel (%s)", _RAW_EXCEL_PATH.name)

    pulled_at = now_utc()

    raw = pd.read_excel(_RAW_EXCEL_PATH, sheet_name=_SHEET_NAME, engine="openpyxl")
    logger.info("WUENIC raw sheet: %d rows", len(raw))

    # Keep only the columns we need
    required = {"ISOCountryCode", "Vaccine", "Year", "WUENIC"}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f"WUENIC sheet missing expected columns: {missing}")

    df = raw[["ISOCountryCode", "Vaccine", "Year", "WUENIC"]].copy()
    df = df.rename(columns={"ISOCountryCode": "iso3", "Year": "year", "WUENIC": "value"})

    # Filter: valid iso3, known vaccine, year in range, non-null value
    df = df.dropna(subset=["iso3", "Vaccine", "year", "value"])
    df["iso3"] = df["iso3"].astype(str).str.strip().str.upper()
    df = df[df["iso3"].str.len() == 3]
    df = df[df["Vaccine"].isin(WUENIC_INDICATORS.keys())]
    df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
    df = df.dropna(subset=["year"])
    df = df[df["year"].between(start_year, end_year)]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["value"])

    # Clamp coverage percentages to [0, 100] — a handful of WUENIC rows
    # round to 100.0001 or similar in the Excel source.
    df["value"] = df["value"].clip(lower=0.0, upper=100.0)

    # Map Vaccine -> (indicator_code, indicator_name)
    df["indicator_code"] = df["Vaccine"].map(lambda v: WUENIC_INDICATORS[v][0])
    df["indicator_name"] = df["Vaccine"].map(lambda v: WUENIC_INDICATORS[v][1])
    df["country_name"]   = df["iso3"].map(get_country_name)
    df["source"]         = "WUENIC"
    df["pulled_at"]      = pulled_at

    records = df[[
        "iso3", "country_name", "year",
        "indicator_code", "indicator_name",
        "value", "source", "pulled_at",
    ]].to_dict(orient="records")

    result = make_standard_df(records)

    if result.empty:
        logger.warning("WUENIC: no data extracted.")
        return result

    validate_standard_df(result, "WUENIC")

    logger.info(
        "WUENIC complete: %d rows | %d countries | %d indicators | years %d–%d",
        len(result),
        result["iso3"].nunique(),
        result["indicator_code"].nunique(),
        int(result["year"].min()),
        int(result["year"].max()),
    )

    if save:
        save_data(result, "wuenic", PROCESSED_DIR)

    return result
