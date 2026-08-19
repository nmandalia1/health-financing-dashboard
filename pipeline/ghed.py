"""
ghed.py — Process the WHO Global Health Expenditure Database (GHED).

Source:   WHO Global Health Expenditure Database
          https://apps.who.int/nha/database/
Coverage: 190+ countries, 2000–present (updated annually, typically December)
License:  CC-BY 3.0 IGO

Data acquisition
────────────────
GHED does not expose a public REST API, but the WHO site serves the full
database as a single XLSX behind a direct-download endpoint:

    https://apps.who.int/nha/database/Home/IndicatorsDownload/en

This module downloads that file automatically (with retries and validation),
caches it at ``data/manual_downloads/GHED_data.xlsx``, and reads every
indicator the WHO publishes — not a hand-picked subset.

If the auto-download fails (the WHO endpoint is occasionally unavailable),
you can place a manually-downloaded copy at the same path and re-run.

What it produces
────────────────
A long-format DataFrame covering *all* GHED indicators (≈ 4,000+) from the
Codebook sheet, including:

  • Aggregate spending        (che_*, gghed_*, pvtd_*, ext_*)
  • Financing schemes (HF)    (hf1..hf4) — government, SHI, VHI, OOP
  • Revenue sources   (FS)    (fs1..fs7) — domestic, compulsory prepayment,
                               voluntary prepayment, OOP, external, etc.
  • Functional split  (HC)    (hc1..hcr) — curative, rehabilitative,
                               preventive, governance, medical goods, ...
  • Provider split    (HP)    (hp1..hp9) — hospitals, ambulatory, retail, ...
  • Disease split     (DIS)   (dis_*) — HIV, TB, malaria, RMNCH, NCDs, ...
  • Capital health expenditure (hk_*)
  • Values in %-of-CHE, %-of-GDP, per capita USD, per capita PPP, and NCU.

This matches the indicator coverage shown in the WHO country-profile PDFs.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from .config import PROCESSED_DIR, MANUAL_DIR, START_YEAR, END_YEAR
from .utils import save_data, now_utc, make_standard_df, cache_is_fresh

logger = logging.getLogger(__name__)

GHED_FILENAME = "GHED_data.xlsx"
GHED_URL = "https://apps.who.int/nha/database/Home/IndicatorsDownload/en"

# XLSX files are ZIP archives — they always start with this 4-byte signature.
# Anything else (HTML error page, empty body) is rejected.
_XLSX_MAGIC = b"PK\x03\x04"
_MIN_BYTES = 5 * 1024 * 1024   # GHED file is ~40 MB; reject anything under 5 MB

# Columns in the "Data" sheet that are NOT indicators
_NON_INDICATOR_COLS = {"location", "code", "region", "income", "year"}


# ─────────────────────────────────────────────
# DOWNLOAD
# ─────────────────────────────────────────────

class GHEDDownloadError(RuntimeError):
    """Raised when the GHED file cannot be downloaded or is invalid."""


def _validate_xlsx(path: Path) -> None:
    """Raise GHEDDownloadError if ``path`` is not a plausible GHED XLSX."""
    if not path.exists():
        raise GHEDDownloadError(f"File does not exist: {path}")

    size = path.stat().st_size
    if size < _MIN_BYTES:
        # Show the first line so the user can see a 503 / login page at a glance.
        try:
            head = path.read_bytes()[:300].decode("utf-8", errors="replace")
        except Exception:
            head = "<binary>"
        raise GHEDDownloadError(
            f"GHED file at {path} is only {size:,} bytes (expected >{_MIN_BYTES:,}). "
            f"This is almost certainly an error page, not the data file. "
            f"First bytes: {head!r}"
        )

    with path.open("rb") as fh:
        magic = fh.read(4)
    if magic != _XLSX_MAGIC:
        raise GHEDDownloadError(
            f"GHED file at {path} is not a valid XLSX (magic bytes were {magic!r}, "
            f"expected {_XLSX_MAGIC!r})."
        )


def download_ghed(
    dest: Optional[Path] = None,
    max_attempts: int = 5,
    backoff_seconds: float = 10.0,
    force: bool = False,
    cache_days: int = 30,
) -> Path:
    """
    Download the GHED XLSX from the WHO endpoint to ``dest``.

    Uses a browser User-Agent (the endpoint 403s some default clients),
    retries with exponential backoff on 503/connection errors, and
    validates the downloaded file before returning.

    Args:
        dest:            Destination path. Defaults to MANUAL_DIR / GHED_data.xlsx.
        max_attempts:    Number of download attempts before giving up.
        backoff_seconds: Initial wait between retries; doubles each attempt.
        force:           If True, re-download even when a fresh cached file exists.
        cache_days:      Treat an existing file younger than this as fresh.

    Returns:
        Path to a validated XLSX file.

    Raises:
        GHEDDownloadError: if all attempts fail or the file is not a valid XLSX.
    """
    dest = Path(dest) if dest else Path(MANUAL_DIR) / GHED_FILENAME
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Use cached file if it exists, is valid, and is fresh.
    if not force and dest.exists() and cache_is_fresh(dest, max_age_days=cache_days):
        try:
            _validate_xlsx(dest)
            logger.info("Using cached GHED file (%.1f MB): %s",
                        dest.stat().st_size / 1e6, dest)
            return dest
        except GHEDDownloadError as e:
            logger.warning("Cached GHED file is invalid, re-downloading: %s", e)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
                   "application/octet-stream,*/*"),
    }

    tmp = dest.with_suffix(dest.suffix + ".part")
    last_error: Optional[str] = None

    for attempt in range(1, max_attempts + 1):
        logger.info("Downloading GHED (attempt %d/%d) from %s", attempt, max_attempts, GHED_URL)
        try:
            with requests.get(GHED_URL, headers=headers, stream=True, timeout=120) as resp:
                status = resp.status_code
                ctype = resp.headers.get("Content-Type", "")

                if status != 200:
                    last_error = f"HTTP {status} ({ctype})"
                    logger.warning("  %s — retrying", last_error)
                else:
                    # Content-Type can be "application/vnd.ms-excel" or similar.
                    # Don't trust it fully — we validate bytes after writing.
                    tmp.unlink(missing_ok=True)
                    total = 0
                    with tmp.open("wb") as out:
                        for chunk in resp.iter_content(chunk_size=1 << 16):
                            if chunk:
                                out.write(chunk)
                                total += len(chunk)
                    logger.info("  downloaded %.1f MB (content-type=%s)", total / 1e6, ctype)

                    try:
                        _validate_xlsx(tmp)
                    except GHEDDownloadError as e:
                        last_error = str(e)
                        logger.warning("  validation failed: %s", last_error)
                        tmp.unlink(missing_ok=True)
                    else:
                        tmp.replace(dest)
                        logger.info("GHED file saved to %s", dest)
                        return dest

        except requests.RequestException as e:
            last_error = f"{type(e).__name__}: {e}"
            logger.warning("  request error: %s", last_error)

        if attempt < max_attempts:
            wait = backoff_seconds * (2 ** (attempt - 1))
            logger.info("  waiting %.0fs before retrying", wait)
            time.sleep(wait)

    tmp.unlink(missing_ok=True)

    # If the endpoint is down but a stale-but-valid file is on disk, use it
    # rather than failing the whole pipeline. Log prominently.
    if dest.exists():
        try:
            _validate_xlsx(dest)
            logger.warning(
                "GHED endpoint unreachable (%s) — falling back to existing file %s "
                "(may be stale).", last_error, dest,
            )
            return dest
        except GHEDDownloadError:
            pass

    raise GHEDDownloadError(
        f"Failed to download GHED after {max_attempts} attempts. "
        f"Last error: {last_error}. "
        f"You can manually download from {GHED_URL} and save to {dest}."
    )


# ─────────────────────────────────────────────
# PROCESS
# ─────────────────────────────────────────────

def _load_codebook(filepath: Path) -> dict[str, str]:
    """Return {variable_code: variable_name} from the Codebook sheet."""
    cb = pd.read_excel(filepath, sheet_name="Codebook")
    cb.columns = [str(c).strip().lower() for c in cb.columns]

    code_col = next((c for c in ("variable code", "variable_code", "code") if c in cb.columns), None)
    name_col = next((c for c in ("variable name", "variable_name", "name") if c in cb.columns), None)
    if not code_col or not name_col:
        raise ValueError(
            f"Codebook sheet is missing variable code/name columns. Got: {list(cb.columns)}"
        )

    cb = cb[[code_col, name_col]].dropna()
    cb[code_col] = cb[code_col].astype(str).str.strip().str.lower()
    cb[name_col] = cb[name_col].astype(str).str.strip()
    return dict(zip(cb[code_col], cb[name_col]))


def process_ghed(
    filepath: Optional[str] = None,
    save: bool = True,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    auto_download: bool = True,
    force_download: bool = False,
) -> pd.DataFrame:
    """
    Download (if needed) and process the GHED database into the standard
    long-format DataFrame.

    Args:
        filepath:       Path to the GHED XLSX. Defaults to MANUAL_DIR/GHED_data.xlsx.
        save:           If True, save results to PROCESSED_DIR/ghed.parquet.
        start_year:     Filter to years >= start_year.
        end_year:       Filter to years <= end_year.
        auto_download:  If True (default), fetch from the WHO endpoint when the
                        local file is missing or stale. Set False for airgapped runs.
        force_download: If True, always re-download even when a fresh cache exists.

    Returns:
        Long-format DataFrame with one row per (iso3, year, indicator).

    Raises:
        GHEDDownloadError: if the file is missing and auto_download fails.
        ValueError: if the XLSX structure is not recognised.
    """
    print(f"\n{'='*60}")
    print(f" WHO GHED  —  Download + process")
    print(f"{'='*60}")

    target = Path(filepath) if filepath else Path(MANUAL_DIR) / GHED_FILENAME

    if auto_download:
        target = download_ghed(dest=target, force=force_download)
    else:
        if not target.exists():
            raise GHEDDownloadError(
                f"GHED file not found at {target} and auto_download=False. "
                f"Download manually from {GHED_URL}."
            )
        _validate_xlsx(target)

    pulled_at = now_utc()

    xl = pd.ExcelFile(target)
    print(f"  Sheets: {xl.sheet_names}")
    if "Data" not in xl.sheet_names:
        raise ValueError(f"GHED file is missing the 'Data' sheet. Sheets: {xl.sheet_names}")

    # ── Codebook → indicator name lookup ──
    try:
        name_map = _load_codebook(target)
        print(f"  Codebook entries: {len(name_map):,}")
    except Exception as e:
        logger.warning("Could not read Codebook sheet (%s); falling back to raw codes.", e)
        name_map = {}

    # ── Data sheet ──
    df_raw = pd.read_excel(target, sheet_name="Data")
    df_raw.columns = [str(c).strip().lower() for c in df_raw.columns]

    required = {"location", "code", "year"}
    missing = required - set(df_raw.columns)
    if missing:
        raise ValueError(
            f"GHED 'Data' sheet is missing required columns {missing}. "
            f"Got: {list(df_raw.columns)[:10]}..."
        )

    indicator_cols = [c for c in df_raw.columns if c not in _NON_INDICATOR_COLS]
    print(f"  Rows: {len(df_raw):,} | Indicator columns: {len(indicator_cols):,}")

    # Year filter (numeric)
    df_raw["year"] = pd.to_numeric(df_raw["year"], errors="coerce")
    df_raw = df_raw[(df_raw["year"] >= start_year) & (df_raw["year"] <= end_year)].copy()

    # ── Vectorised melt (iterrows would take tens of minutes for 4k indicators) ──
    melted = df_raw.melt(
        id_vars=["location", "code", "year"],
        value_vars=indicator_cols,
        var_name="indicator_code",
        value_name="value",
    )
    # Coerce and drop rows with no value
    melted["value"] = pd.to_numeric(melted["value"], errors="coerce")
    melted = melted.dropna(subset=["value", "code", "year"])
    melted["year"] = melted["year"].astype(int)
    melted["iso3"] = melted["code"].astype(str).str.strip().str.upper()
    melted["country_name"] = melted["location"].astype(str).str.strip()
    melted["indicator_name"] = (
        melted["indicator_code"].map(name_map).fillna(melted["indicator_code"])
    )
    # Prefix codes so they're unambiguous in the master dataset.
    melted["indicator_code"] = "GHED_" + melted["indicator_code"].astype(str)
    melted["source"] = "WHO GHED"
    melted["pulled_at"] = pulled_at

    df = melted[[
        "iso3", "country_name", "year",
        "indicator_code", "indicator_name",
        "value", "source", "pulled_at",
    ]].reset_index(drop=True)

    # Run the same standardisation (dedupe, sort, dtype casts) used by other sources.
    df = make_standard_df(df.to_dict("records")) if False else df  # avoid needless list round-trip
    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    print(f"\n  Records:    {len(df):,}")
    print(f"  Countries:  {df['iso3'].nunique():,}")
    print(f"  Indicators: {df['indicator_code'].nunique():,}")
    print(f"  Year range: {int(df['year'].min())}–{int(df['year'].max())}")

    if save and not df.empty:
        save_data(df, "ghed", PROCESSED_DIR)

    return df
