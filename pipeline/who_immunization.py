"""
who_immunization.py — WHO JRF Immunization Financing data.

Source:   WHO Joint Reporting Form (JRF) — reviewed vaccine expenditure data
URL:      https://cdn.who.int/media/docs/default-source/immunization/financing/
          reviewed-jrf-reported-expenditure-data-on-vaccines---october-2025.xlsx
Coverage: ~195 countries, 2006–2024
License:  CC-BY-IGO 3.0 (https://www.who.int/about/policies/publishing/copyright)

Three time-series are extracted from the Excel workbook:
  WHO_IMM_GOV_VAX_USD  — Government vaccine expenditure (current USD)
  WHO_IMM_TOT_VAX_USD  — Total vaccine expenditure (current USD)
  WHO_IMM_GOV_SHARE    — Government share of vaccine expenditure (0–1 proportion)

The file is re-downloaded when the local cache is older than CACHE_MAX_AGE_DAYS.
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
    WHO_IMMUNIZATION_INDICATORS,
    WHO_IMMUNIZATION_URL,
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

CACHE_MAX_AGE_DAYS  = 90   # Excel is published ~annually; refresh quarterly
REQUEST_TIMEOUT     = 120  # Large file (~280 KB), allow extra time
IMM_CACHE_DIR       = Path(RAW_DIR) / "who_immunization"
_RAW_EXCEL_PATH     = IMM_CACHE_DIR / "jrf_vaccine_expenditure.xlsx"

# Sheet name → (indicator_code, id_cols_before_years)
# 'Government vaccine expenditure' and 'Total vaccine expenditure' both have
# a 'report' column; 'Share paid by government' does not.
_SHEET_MAP: dict[str, tuple[str, list[str]]] = {
    "Government vaccine expenditure": (
        "WHO_IMM_GOV_VAX_USD",
        ["country", "iso", "report", "region", "income"],
    ),
    "Total vaccine expenditure": (
        "WHO_IMM_TOT_VAX_USD",
        ["country", "iso", "report", "region", "income"],
    ),
    "Share paid by government": (
        "WHO_IMM_GOV_SHARE",
        ["country", "iso", "region", "income"],
    ),
}


def _build_session() -> requests.Session:
    """Shared session with retry on transient errors."""
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
    """Download the JRF Excel file, streaming to avoid loading it all into RAM."""
    logger.info("Downloading WHO immunization Excel from WHO CDN…")
    resp = _SESSION.get(WHO_IMMUNIZATION_URL, timeout=REQUEST_TIMEOUT, stream=True)
    resp.raise_for_status()

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.xlsx")
    try:
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=65_536):
                f.write(chunk)
        tmp.rename(dest)
        logger.info("Downloaded: %s (%.1f KB)", dest.name, dest.stat().st_size / 1024)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _parse_sheet(
    xl: pd.ExcelFile,
    sheet: str,
    id_cols: list[str],
    indicator_code: str,
    indicator_name: str,
    start_year: int,
    end_year: int,
    pulled_at: str,
) -> pd.DataFrame:
    """
    Parse one wide-format sheet into a standard long-format DataFrame.

    The first row is a header containing the metadata column names followed by
    year values (stored as floats like 2006.0). Data rows begin at index 1.
    Years outside [start_year, end_year] are dropped. NaN values are dropped.
    """
    raw = xl.parse(sheet, header=None)

    # Row 0 is the header
    header = raw.iloc[0].tolist()
    data   = raw.iloc[1:].copy()
    data.columns = header

    # Identify year columns — they are numeric floats in the header
    year_cols: list[float] = [
        c for c in header
        if isinstance(c, (int, float)) and start_year <= int(c) <= end_year
    ]

    if not year_cols:
        logger.warning("No year columns in range %d–%d for sheet %r", start_year, end_year, sheet)
        return pd.DataFrame()

    # Melt from wide to long
    available_id_cols = [c for c in id_cols if c in data.columns]
    melted = data[available_id_cols + year_cols].melt(
        id_vars=available_id_cols,
        var_name="year_float",
        value_name="value",
    )
    melted = melted.dropna(subset=["value"])
    melted["year"] = melted["year_float"].astype(int)

    # iso column is called 'iso' in all sheets
    if "iso" not in melted.columns:
        logger.error("No 'iso' column found in sheet %r", sheet)
        return pd.DataFrame()

    records: list[dict] = []
    for _, row in melted.iterrows():
        iso3 = str(row.get("iso", "")).strip()
        if not iso3 or len(iso3) != 3 or not iso3.isalpha():
            continue
        try:
            value = float(row["value"])
        except (TypeError, ValueError):
            continue

        # Clamp share values to [0, 1] — raw JRF data has minor float overflows
        # (e.g. 1.000154) due to rounding in the Excel source.
        if indicator_code == "WHO_IMM_GOV_SHARE":
            value = min(max(value, 0.0), 1.0)

        records.append({
            "iso3":           iso3,
            "country_name":   get_country_name(iso3),
            "year":           int(row["year"]),
            "indicator_code": indicator_code,
            "indicator_name": indicator_name,
            "value":          value,
            "source":         "WHO Immunization",
            "pulled_at":      pulled_at,
        })

    if not records:
        return pd.DataFrame()

    return make_standard_df(records)


def fetch_who_immunization(
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    save: bool = True,
    cache_max_age_days: int = CACHE_MAX_AGE_DAYS,
) -> pd.DataFrame:
    """
    Download (or load from cache) the WHO JRF immunization expenditure Excel
    and return a standardised long-format DataFrame with three indicators:
      - Government vaccine expenditure (USD)
      - Total vaccine expenditure (USD)
      - Government share of vaccine expenditure (proportion)

    Args:
        start_year:         First year to include (default: config.START_YEAR).
        end_year:           Last year to include (default: config.END_YEAR).
        save:               If True, write the result to processed/.
        cache_max_age_days: Re-download the Excel when older than this many days.

    Returns:
        Standard long-format DataFrame.
    """
    # Download if missing or stale
    if not cache_is_fresh(_RAW_EXCEL_PATH, cache_max_age_days):
        _download_excel(_RAW_EXCEL_PATH)
    else:
        logger.info(
            "WHO Immunization: using cached Excel (%s)",
            _RAW_EXCEL_PATH.name,
        )

    pulled_at = now_utc()
    all_dfs: list[pd.DataFrame] = []

    xl = pd.ExcelFile(_RAW_EXCEL_PATH, engine="openpyxl")

    for sheet, (ind_code, id_cols) in _SHEET_MAP.items():
        ind_name = WHO_IMMUNIZATION_INDICATORS.get(ind_code, ind_code)
        logger.info("Parsing sheet: %r → %s", sheet, ind_code)

        df = _parse_sheet(
            xl, sheet, id_cols, ind_code, ind_name,
            start_year, end_year, pulled_at,
        )

        if df.empty:
            logger.warning("No data from sheet %r — skipped.", sheet)
        else:
            logger.info(
                "  %s: %d rows | %d countries",
                ind_code, len(df), df["iso3"].nunique(),
            )
            all_dfs.append(df)

    xl.close()

    if not all_dfs:
        logger.warning("WHO Immunization: no data extracted.")
        return pd.DataFrame()

    result = pd.concat(all_dfs, ignore_index=True)
    result = result.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    validate_standard_df(result, "WHO Immunization")

    logger.info(
        "WHO Immunization complete: %d rows | %d countries | %d indicators",
        len(result), result["iso3"].nunique(), result["indicator_code"].nunique(),
    )

    if save and not result.empty:
        save_data(result, "who_immunization", PROCESSED_DIR)

    return result
