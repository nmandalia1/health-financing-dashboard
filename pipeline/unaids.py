"""
unaids.py — Download and process UNAIDS AIDSinfo HIV/AIDS data.

Source:   UNAIDS (Joint United Nations Programme on HIV/AIDS)
          https://aidsinfo.unaids.org/dataset
Coverage: 170+ countries, 1990–latest
License:  Creative Commons Attribution 3.0 IGO

Data acquisition
────────────────
UNAIDS publishes annual bulk ZIPs at:
    Estimates: https://aidsinfo.unaids.org/public/documents/Estimates_{year}_en.zip
    GAM:       https://aidsinfo.unaids.org/public/documents/GAM_{year}_en.zip

Both are downloaded automatically, cached for 90 days, and extracted to
    data/manual_downloads/unaids/

If auto-download fails, place CSV files manually in that directory and re-run.

AIDSinfo CSV format (2025):
    Columns: Indicator, Indicator_GId, Unit, Subgroup, Subgroup_Val_GId,
             Area, Area ID, Time Period, Source, Data value, Formatted,
             Data_Denominator, Footnote
    Area ID: ISO3 code for countries; UN region codes (e.g. 03M49WLD) for aggregates
    Subgroup: disaggregation (age/sex/estimate type) — we keep central estimates only

Indicators produced:
  UNAIDS_PLHIV                People living with HIV (number)
  UNAIDS_NEW_INFECTIONS       New HIV infections (number)
  UNAIDS_AIDS_DEATHS          AIDS-related deaths (number)
  UNAIDS_PREVALENCE_ADULTS    HIV prevalence, adults 15–49 (%)
  UNAIDS_INCIDENCE_RATE       HIV incidence rate (per 1,000 population)
  UNAIDS_ART_COVERAGE         ART coverage — PLHIV receiving ART (%)
  UNAIDS_95_DIAGNOSED         PLHIV who know their status (%)
  UNAIDS_95_ON_ART            Diagnosed PLHIV on ART (%)
  UNAIDS_95_SUPPRESSED        PLHIV on ART with viral suppression (%)
  UNAIDS_PMTCT                PMTCT — ART coverage for pregnant women (%)
  UNAIDS_FIN_TOTAL            Total HIV financing (USD)
  UNAIDS_FIN_DOMESTIC_ALL     Total domestic HIV financing (USD)
  UNAIDS_FIN_DOMESTIC_GOV     Domestic government HIV financing (USD)
  UNAIDS_FIN_DOMESTIC_PRIV    Domestic private HIV financing (USD)
  UNAIDS_FIN_INTERNATIONAL    International HIV financing received (USD)
  UNAIDS_FIN_GLOBAL_FUND      HIV financing from Global Fund (USD)
  UNAIDS_FIN_PEPFAR            HIV financing from PEPFAR (USD)
"""

from __future__ import annotations

import logging
import os
import re
import time
import zipfile
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from .config import (
    PROCESSED_DIR, UNAIDS_DIR, START_YEAR, END_YEAR,
    UNAIDS_INDICATORS, UNAIDS_FINANCE_SUBGROUPS,
    UNAIDS_LATEST_YEAR, UNAIDS_ESTIMATES_URL, UNAIDS_GAM_URL,
)
from .utils import get_country_name, save_data, now_utc, make_standard_df, cache_is_fresh

logger = logging.getLogger(__name__)

_ZIP_MAGIC  = b"PK\x03\x04"
_MIN_BYTES  = 50 * 1024   # reject anything smaller than 50 KB
_CACHE_DAYS = 90          # AIDSinfo releases annually

# AIDSinfo column names (2025 format)
_COL_ISO3      = "Area ID"
_COL_YEAR      = "Time Period"
_COL_INDICATOR = "Indicator"
_COL_SUBGROUP  = "Subgroup"
_COL_VALUE     = "Data value"
_COL_COUNTRY   = "Area"

# Financing indicator name in the GAM file
_FINANCE_INDICATOR = "Country-reported HIV expenditure by funding source"

# Preferred subgroup priority for picking the central estimate of each indicator.
# For each (indicator, iso3, year) combination we pick the first subgroup that
# is present in the data — this gives us the most aggregate central estimate.
_SUBGROUP_PRIORITY = [
    "All ages estimate",
    "Total estimate",
    "estimate",
    "Adults (15-49) estimate modelled",
    "Adults (15-49) estimate",
    "Adults (15+) estimate",
    "Total",
    "All ages",
    "All sexes",
    "program data",
]
_SUBGROUP_PRIORITY_INDEX = {s: i for i, s in enumerate(_SUBGROUP_PRIORITY)}

# ISO3 pattern: exactly 3 uppercase letters — filters out UN region codes
_ISO3_RE = re.compile(r"^[A-Z]{3}$")


# ─────────────────────────────────────────────
# DOWNLOAD
# ─────────────────────────────────────────────

class UNAIDSDownloadError(RuntimeError):
    """Raised when a UNAIDS ZIP cannot be downloaded or extracted."""


def _validate_zip(path: Path) -> None:
    if not path.exists():
        raise UNAIDSDownloadError(f"File does not exist: {path}")
    size = path.stat().st_size
    if size < _MIN_BYTES:
        try:
            head = path.read_bytes()[:300].decode("utf-8", errors="replace")
        except Exception:
            head = "<binary>"
        raise UNAIDSDownloadError(
            f"{path} is only {size:,} bytes — likely an error page. First bytes: {head!r}"
        )
    with path.open("rb") as fh:
        if fh.read(4) != _ZIP_MAGIC:
            raise UNAIDSDownloadError(f"{path} is not a valid ZIP archive.")


def _download_zip(url: str, dest: Path, label: str,
                  max_attempts: int = 3, backoff: float = 5.0) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/zip,application/octet-stream,*/*",
    }
    last_error: Optional[str] = None
    for attempt in range(1, max_attempts + 1):
        print(f"  Downloading {label} (attempt {attempt}/{max_attempts})...")
        try:
            with requests.get(url, headers=headers, stream=True, timeout=120) as resp:
                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code}"
                else:
                    tmp.unlink(missing_ok=True)
                    total = 0
                    with tmp.open("wb") as fh:
                        for chunk in resp.iter_content(chunk_size=1 << 16):
                            if chunk:
                                fh.write(chunk)
                                total += len(chunk)
                    print(f"  Downloaded {total / 1e6:.1f} MB")
                    try:
                        _validate_zip(tmp)
                        tmp.replace(dest)
                        return dest
                    except UNAIDSDownloadError as e:
                        last_error = str(e)
                        tmp.unlink(missing_ok=True)
        except requests.RequestException as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < max_attempts:
            wait = backoff * (2 ** (attempt - 1))
            print(f"  Retrying in {wait:.0f}s...")
            time.sleep(wait)
    tmp.unlink(missing_ok=True)
    raise UNAIDSDownloadError(
        f"Failed to download {label} after {max_attempts} attempts. "
        f"Last error: {last_error}. URL: {url}"
    )


def _try_years_download(url_template: str, label: str, dest_template: Path) -> Path:
    for year in [UNAIDS_LATEST_YEAR, UNAIDS_LATEST_YEAR - 1]:
        url  = url_template.format(year=year)
        dest = Path(str(dest_template).replace("{year}", str(year)))
        try:
            return _download_zip(url, dest, f"{label} {year}")
        except UNAIDSDownloadError as e:
            logger.warning("Could not fetch %s %d: %s", label, year, e)
            print(f"  ⚠ {label} {year} unavailable, trying {year - 1}...")
    raise UNAIDSDownloadError(
        f"Could not download {label} for {UNAIDS_LATEST_YEAR} or {UNAIDS_LATEST_YEAR - 1}."
    )


def _extract_csvs(zip_path: Path, dest_dir: Path) -> list[Path]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    extracted = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.namelist():
            if member.lower().endswith(".csv") and not member.startswith("__MACOSX"):
                name = Path(member).name
                out_path = dest_dir / name
                out_path.write_bytes(zf.read(member))
                extracted.append(out_path)
    return extracted


def download_unaids(dest_dir: Optional[Path] = None,
                    force: bool = False,
                    cache_days: int = _CACHE_DAYS) -> list[Path]:
    """
    Download the UNAIDS Estimates and GAM ZIPs, extract CSV files, and return
    the list of extracted CSV paths. Uses a 90-day cache.
    """
    dest_dir = Path(dest_dir) if dest_dir else Path(UNAIDS_DIR)
    dest_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = dest_dir / "_zips"
    raw_dir.mkdir(parents=True, exist_ok=True)

    existing_csvs = [p for p in dest_dir.glob("*.csv")]
    if not force and existing_csvs:
        newest = max(existing_csvs, key=lambda p: p.stat().st_mtime)
        if cache_is_fresh(newest, max_age_days=cache_days):
            print(f"  Using cached UNAIDS files ({len(existing_csvs)} CSVs)")
            return existing_csvs

    downloads = [
        (UNAIDS_ESTIMATES_URL, "Estimates"),
        (UNAIDS_GAM_URL,       "GAM"),
    ]
    all_csvs: list[Path] = []
    any_succeeded = False

    for url_template, label in downloads:
        dest_template = raw_dir / f"unaids_{label.lower()}_{{year}}.zip"

        # Reuse cached ZIP if fresh
        cached = sorted(raw_dir.glob(f"unaids_{label.lower()}_*.zip"))
        fresh_zip: Optional[Path] = None
        if not force and cached:
            newest_zip = max(cached, key=lambda p: p.stat().st_mtime)
            if cache_is_fresh(newest_zip, max_age_days=cache_days):
                try:
                    _validate_zip(newest_zip)
                    fresh_zip = newest_zip
                    print(f"  Using cached {label} ZIP: {newest_zip.name}")
                except UNAIDSDownloadError:
                    pass

        if fresh_zip is None:
            try:
                fresh_zip = _try_years_download(url_template, label, dest_template)
            except UNAIDSDownloadError as e:
                print(f"  ✗ Could not download {label}: {e}")
                continue

        try:
            csvs = _extract_csvs(fresh_zip, dest_dir)
            print(f"  ✓ {label}: extracted {len(csvs)} CSV file(s)")
            all_csvs.extend(csvs)
            any_succeeded = True
        except Exception as e:
            print(f"  ✗ Could not extract {label} ZIP: {e}")

    if not any_succeeded:
        fallback = [p for p in dest_dir.glob("*.csv")]
        if fallback:
            print(f"  ⚠ Downloads failed — using {len(fallback)} existing CSV(s).")
            return fallback
        raise UNAIDSDownloadError(
            "Could not download UNAIDS data and no local CSVs found. "
            f"Download manually from https://aidsinfo.unaids.org/dataset → {dest_dir}"
        )

    return all_csvs


# ─────────────────────────────────────────────
# PARSE
# ─────────────────────────────────────────────

def _pick_central_estimates(df: pd.DataFrame) -> pd.DataFrame:
    """
    For each (Indicator, Area ID, Time Period) group keep the single row whose
    Subgroup ranks highest in _SUBGROUP_PRIORITY.  Rows with subgroups not in
    the priority list are dropped — this removes upper/lower CI bounds,
    sex/age disaggregations, and other non-total rows.
    """
    df = df.copy()
    df["_prio"] = df[_COL_SUBGROUP].map(_SUBGROUP_PRIORITY_INDEX)
    df = df.dropna(subset=["_prio"])
    df["_prio"] = df["_prio"].astype(int)

    # Keep the row with the lowest priority index (highest priority) per group
    idx = (
        df.groupby([_COL_INDICATOR, _COL_ISO3, _COL_YEAR], observed=True)["_prio"]
        .idxmin()
    )
    return df.loc[idx].drop(columns=["_prio"]).reset_index(drop=True)


def _parse_estimates_csv(df: pd.DataFrame, start_year: int, end_year: int,
                         pulled_at: str) -> list[dict]:
    """Parse Estimates file: standard indicator → central estimate rows."""
    # Keep only indicators we care about
    df = df[df[_COL_INDICATOR].isin(UNAIDS_INDICATORS)].copy()
    if df.empty:
        return []

    df = _pick_central_estimates(df)

    records = []
    for _, row in df.iterrows():
        iso3 = str(row[_COL_ISO3]).strip().upper()
        if not _ISO3_RE.match(iso3):
            continue
        try:
            val  = float(str(row[_COL_VALUE]).replace(",", ""))
            year = int(row[_COL_YEAR])
        except (ValueError, TypeError):
            continue
        if not (start_year <= year <= end_year):
            continue

        ind_name = str(row[_COL_INDICATOR]).strip()
        code, name = UNAIDS_INDICATORS[ind_name]
        country = str(row[_COL_COUNTRY]).strip() if pd.notna(row.get(_COL_COUNTRY)) else get_country_name(iso3)

        records.append({
            "iso3": iso3, "country_name": country, "year": year,
            "indicator_code": code, "indicator_name": name,
            "value": val, "source": "UNAIDS", "pulled_at": pulled_at,
        })
    return records


def _parse_gam_csv(df: pd.DataFrame, start_year: int, end_year: int,
                   pulled_at: str) -> list[dict]:
    """
    Parse GAM file:
    - Financing indicator: subgroup determines the indicator code
    - All other GAM indicators: use UNAIDS_INDICATORS mapping (if present)
    """
    records = []

    # ── Financing indicator (subgroup → code) ──
    fin_df = df[df[_COL_INDICATOR] == _FINANCE_INDICATOR].copy()
    fin_df = fin_df[fin_df[_COL_SUBGROUP].isin(UNAIDS_FINANCE_SUBGROUPS)]
    for _, row in fin_df.iterrows():
        iso3 = str(row[_COL_ISO3]).strip().upper()
        if not _ISO3_RE.match(iso3):
            continue
        try:
            val  = float(str(row[_COL_VALUE]).replace(",", ""))
            year = int(row[_COL_YEAR])
        except (ValueError, TypeError):
            continue
        if not (start_year <= year <= end_year):
            continue

        subgroup = str(row[_COL_SUBGROUP]).strip()
        code, name = UNAIDS_FINANCE_SUBGROUPS[subgroup]
        country = str(row[_COL_COUNTRY]).strip() if pd.notna(row.get(_COL_COUNTRY)) else get_country_name(iso3)

        records.append({
            "iso3": iso3, "country_name": country, "year": year,
            "indicator_code": code, "indicator_name": name,
            "value": val, "source": "UNAIDS", "pulled_at": pulled_at,
        })

    # ── Other GAM indicators in UNAIDS_INDICATORS map ──
    other_df = df[
        (df[_COL_INDICATOR] != _FINANCE_INDICATOR) &
        (df[_COL_INDICATOR].isin(UNAIDS_INDICATORS))
    ].copy()
    if not other_df.empty:
        other_df = _pick_central_estimates(other_df)
        for _, row in other_df.iterrows():
            iso3 = str(row[_COL_ISO3]).strip().upper()
            if not _ISO3_RE.match(iso3):
                continue
            try:
                val  = float(str(row[_COL_VALUE]).replace(",", ""))
                year = int(row[_COL_YEAR])
            except (ValueError, TypeError):
                continue
            if not (start_year <= year <= end_year):
                continue

            ind_name = str(row[_COL_INDICATOR]).strip()
            code, name = UNAIDS_INDICATORS[ind_name]
            country = str(row[_COL_COUNTRY]).strip() if pd.notna(row.get(_COL_COUNTRY)) else get_country_name(iso3)

            records.append({
                "iso3": iso3, "country_name": country, "year": year,
                "indicator_code": code, "indicator_name": name,
                "value": val, "source": "UNAIDS", "pulled_at": pulled_at,
            })

    return records


def _is_estimates_file(df: pd.DataFrame) -> bool:
    """Detect whether a CSV is the Estimates file (vs. GAM) by its indicators."""
    return "People living with HIV" in df[_COL_INDICATOR].values


def _parse_csv(fpath: str | Path, start_year: int, end_year: int,
               pulled_at: str) -> list[dict]:
    try:
        df = pd.read_csv(fpath, encoding="utf-8-sig", low_memory=False)
    except UnicodeDecodeError:
        df = pd.read_csv(fpath, encoding="latin-1", low_memory=False)

    df.columns = [str(c).strip() for c in df.columns]

    required = {_COL_ISO3, _COL_YEAR, _COL_INDICATOR, _COL_VALUE, _COL_SUBGROUP}
    missing = required - set(df.columns)
    if missing:
        print(f"  ⚠ Cannot parse {os.path.basename(str(fpath))} — "
              f"missing columns: {sorted(missing)}")
        print(f"    Available: {list(df.columns)[:15]}")
        return []

    df[_COL_YEAR] = pd.to_numeric(df[_COL_YEAR], errors="coerce")
    df = df.dropna(subset=[_COL_ISO3, _COL_VALUE, _COL_YEAR])

    if _is_estimates_file(df):
        return _parse_estimates_csv(df, start_year, end_year, pulled_at)
    else:
        return _parse_gam_csv(df, start_year, end_year, pulled_at)


# ─────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────

def process_unaids(
    directory:      str  = None,
    save:           bool = True,
    start_year:     int  = START_YEAR,
    end_year:       int  = END_YEAR,
    auto_download:  bool = True,
    force_download: bool = False,
) -> pd.DataFrame:
    """
    Download (if needed) and process UNAIDS AIDSinfo data into the standard
    long-format DataFrame.

    Args:
        directory:      Directory containing (or to download into) CSV files.
                        Defaults to data/manual_downloads/unaids/
        save:           If True, save results to processed/unaids.parquet.
        start_year:     Filter to years >= start_year.
        end_year:       Filter to years <= end_year.
        auto_download:  If True (default), fetch ZIPs from aidsinfo.unaids.org.
        force_download: If True, re-download even when a fresh cache exists.

    Returns:
        Standardised long-format DataFrame, or empty DataFrame on failure.
    """
    dest_dir = Path(directory) if directory else Path(UNAIDS_DIR)

    print(f"\n{'='*60}")
    print(f" UNAIDS  —  AIDSinfo HIV/AIDS data")
    print(f"{'='*60}")

    if auto_download:
        try:
            csv_files = download_unaids(dest_dir=dest_dir, force=force_download)
        except UNAIDSDownloadError as e:
            print(f"\n  ✗ Auto-download failed: {e}")
            return pd.DataFrame()
    else:
        csv_files = list(dest_dir.glob("*.csv"))
        if not csv_files:
            print(f"\n  ⚠ No CSV files in {dest_dir} and auto_download=False.")
            return pd.DataFrame()

    csv_files = [p for p in csv_files if str(p).lower().endswith(".csv")]
    if not csv_files:
        print("  ✗ No CSV files to parse.")
        return pd.DataFrame()

    print(f"  Parsing {len(csv_files)} CSV file(s)...")
    pulled_at   = now_utc()
    all_records = []

    for fpath in csv_files:
        fname = os.path.basename(str(fpath))
        print(f"  Loading {fname}...")
        try:
            records = _parse_csv(fpath, start_year, end_year, pulled_at)
            print(f"    → {len(records):,} records")
            all_records.extend(records)
        except Exception as e:
            print(f"  ✗ Error parsing {fname}: {e}")
            logger.exception("Error parsing %s", fpath)

    if not all_records:
        print("  ✗ No records extracted.")
        return pd.DataFrame()

    df = make_standard_df(all_records)
    df = df.drop_duplicates(subset=["iso3", "year", "indicator_code"])

    print(f"\n  Total records: {len(df):,}")
    print(f"  Countries:     {df['iso3'].nunique()}")
    print(f"  Indicators:    {df['indicator_code'].nunique()}")
    print(f"  Codes found:")
    for code in sorted(df["indicator_code"].unique()):
        n = (df["indicator_code"] == code).sum()
        print(f"    • {code:<35} {n:>5} rows")

    if save and not df.empty:
        save_data(df, "unaids", PROCESSED_DIR)

    return df
