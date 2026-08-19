"""
pefa.py — Process the PEFA (Public Expenditure and Financial Accountability) dataset.

Source:   PEFA Secretariat, distributed via the World Bank Databank
          https://databank.worldbank.org/source/pefa-2016
          https://databank.worldbank.org/source/pefa-2011
License:  CC-BY 4.0

Data acquisition
────────────────
Two frozen bulk CSVs are published behind direct-download URLs:

    https://databank.worldbank.org/data/download/PEFA2016_CSV.zip
    https://databank.worldbank.org/data/download/PEFA2011_CSV.zip

Each ZIP contains Data.csv in wide format:
  rows = (Country × Indicator), columns = YYYYMM assessment dates.

This module downloads both ZIPs, melts them to long format, and emits a
single standard-schema DataFrame covering both frameworks.

Known limitation
────────────────
The World Bank bulk files were last refreshed in Feb 2020 (latest
assessments: 2019-07). More recent assessments exist on pefa.org but
require per-country extraction; we flag `pefa_framework_vintage` in the
manifest so dashboards can surface the recency gap.

Indicator codes produced
────────────────────────
All codes are namespaced by framework so 2011 and 2016 scores never
collide in the master parquet:

  PEFA16_PI-01 .. PEFA16_PI-31      top-level PI scores (0–4)
  PEFA16_PI-01.1 ..                  dimension-level scores (0–4)
  PEFA16_PILLAR3_AVG                 mean of PI-19..PI-26 (Tapsoba's pillar)
  PEFA16_BUDGET_RELIAB_AVG           mean of PI-01..PI-03 (Pillar I)
  PEFA16_OVERALL_AVG                 mean of all 31 PIs
  PEFA11_PI-01 .. PEFA11_PI-28      2011 framework equivalents
  PEFA11_PCBE_AVG                    2011 Predictability & Control (PI-16..PI-21)
  PEFA11_BUDGET_RELIAB_AVG           PI-01..PI-04
  PEFA11_OVERALL_AVG                 mean of all 28 PIs
"""

from __future__ import annotations

import logging
import time
import zipfile
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from .config import PROCESSED_DIR, MANUAL_DIR, START_YEAR, END_YEAR
from .utils import save_data, now_utc, cache_is_fresh, standardise_iso3, WB_TO_ISO3

logger = logging.getLogger(__name__)

PEFA_DIR_NAME = "pefa"
PEFA_FILES = {
    "2016": {
        "url": "https://databank.worldbank.org/data/download/PEFA2016_CSV.zip",
        "zip_name": "PEFA2016_CSV.zip",
        "csv_path": "Data.csv",
    },
    "2011": {
        "url": "https://databank.worldbank.org/data/download/PEFA2011_CSV.zip",
        "zip_name": "PEFA2011_CSV.zip",
        "csv_path": "Data.csv",
    },
}

_ZIP_MAGIC = b"PK\x03\x04"
_MIN_BYTES = 30_000  # 2016 CSV zip is ~70KB; reject anything smaller than 30KB

# Pillar / group definitions used to compute derived averages.
# PEFA 2016 framework (7 pillars, 31 PIs):
#   Pillar I   "Budget reliability"                    PI-1..PI-3
#   Pillar II  "Transparency of public finances"       PI-4..PI-9
#   Pillar III "Mgmt of assets and liabilities"        PI-10..PI-13
#   Pillar IV  "Policy-based fiscal strategy/budget"   PI-14..PI-18
#   Pillar V   "Predictability & Control in Budget Execution"  PI-19..PI-26  ← Tapsoba
#   Pillar VI  "Accounting & reporting"                PI-27..PI-29
#   Pillar VII "External scrutiny and audit"           PI-30..PI-31
PEFA16_PILLARS: dict[str, list[int]] = {
    "BUDGET_RELIAB":  list(range(1, 4)),    # Pillar I
    "TRANSPARENCY":   list(range(4, 10)),   # Pillar II
    "ASSETS_LIAB":    list(range(10, 14)),  # Pillar III
    "FISCAL_POLICY":  list(range(14, 19)),  # Pillar IV
    "PILLAR3":        list(range(19, 27)),  # Pillar V — Predictability & Control in Budget Execution
    "ACCOUNTING":     list(range(27, 30)),  # Pillar VI
    "AUDIT":          list(range(30, 32)),  # Pillar VII
}

# PEFA 2011 framework (28 PIs — different grouping):
#   A. Credibility of the budget              PI-1..PI-4
#   B. Comprehensiveness and transparency     PI-5..PI-10
#   C(i). Policy-based budgeting              PI-11..PI-12
#   C(ii). Predictability and Control in Budget Execution  PI-13..PI-21
#   C(iii). Accounting, recording, reporting  PI-22..PI-25
#   C(iv). External scrutiny and audit        PI-26..PI-28
PEFA11_PILLARS: dict[str, list[int]] = {
    "BUDGET_RELIAB":  list(range(1, 5)),
    "TRANSPARENCY":   list(range(5, 11)),
    "POLICY_BUDGET":  list(range(11, 13)),
    "PCBE":           list(range(13, 22)),   # Predictability & Control (wider scope than 2016)
    "ACCOUNTING":     list(range(22, 26)),
    "AUDIT":          list(range(26, 29)),
}


# ─────────────────────────────────────────────
# DOWNLOAD
# ─────────────────────────────────────────────

class PEFADownloadError(RuntimeError):
    """Raised when a PEFA bulk file cannot be downloaded or is invalid."""


def _validate_zip(path: Path) -> None:
    if not path.exists():
        raise PEFADownloadError(f"File does not exist: {path}")
    size = path.stat().st_size
    if size < _MIN_BYTES:
        head = path.read_bytes()[:300].decode("utf-8", errors="replace")
        raise PEFADownloadError(
            f"PEFA file at {path} is only {size:,} bytes — likely an error page. "
            f"First bytes: {head!r}"
        )
    with path.open("rb") as fh:
        magic = fh.read(4)
    if magic != _ZIP_MAGIC:
        raise PEFADownloadError(
            f"PEFA file at {path} is not a valid ZIP (magic bytes {magic!r})."
        )


def _download_one(
    url: str,
    dest: Path,
    max_attempts: int = 4,
    backoff_seconds: float = 5.0,
    force: bool = False,
    cache_days: int = 180,
) -> Path:
    """Download a single PEFA ZIP with retry + validation. Cache 180d (data is static)."""
    dest.parent.mkdir(parents=True, exist_ok=True)

    if not force and dest.exists() and cache_is_fresh(dest, max_age_days=cache_days):
        try:
            _validate_zip(dest)
            logger.info("Using cached PEFA file: %s (%.1f KB)", dest, dest.stat().st_size / 1024)
            return dest
        except PEFADownloadError as e:
            logger.warning("Cached PEFA file invalid, re-downloading: %s", e)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    }
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_error: Optional[str] = None

    for attempt in range(1, max_attempts + 1):
        logger.info("Downloading %s (attempt %d/%d)", url, attempt, max_attempts)
        try:
            with requests.get(url, headers=headers, stream=True, timeout=60) as resp:
                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code}"
                    logger.warning("  %s — retrying", last_error)
                else:
                    tmp.unlink(missing_ok=True)
                    total = 0
                    with tmp.open("wb") as out:
                        for chunk in resp.iter_content(chunk_size=1 << 15):
                            if chunk:
                                out.write(chunk)
                                total += len(chunk)
                    logger.info("  downloaded %.1f KB", total / 1024)
                    try:
                        _validate_zip(tmp)
                    except PEFADownloadError as e:
                        last_error = str(e)
                        logger.warning("  validation failed: %s", last_error)
                        tmp.unlink(missing_ok=True)
                    else:
                        tmp.replace(dest)
                        return dest
        except requests.RequestException as e:
            last_error = f"{type(e).__name__}: {e}"
            logger.warning("  request error: %s", last_error)

        if attempt < max_attempts:
            time.sleep(backoff_seconds * (2 ** (attempt - 1)))

    tmp.unlink(missing_ok=True)

    # Fall back to existing file if present and valid, even if stale
    if dest.exists():
        try:
            _validate_zip(dest)
            logger.warning(
                "Endpoint unreachable (%s) — using existing file %s (may be stale)",
                last_error, dest,
            )
            return dest
        except PEFADownloadError:
            pass

    raise PEFADownloadError(
        f"Failed to download PEFA file from {url} after {max_attempts} attempts. "
        f"Last error: {last_error}. Manually place at {dest} to continue."
    )


def download_pefa(force: bool = False) -> dict[str, Path]:
    """
    Download both PEFA bulk ZIPs to data/manual_downloads/pefa/.

    Returns:
        Dict of framework version → Path to the downloaded ZIP.
    """
    pefa_dir = Path(MANUAL_DIR) / PEFA_DIR_NAME
    out: dict[str, Path] = {}
    for fw, spec in PEFA_FILES.items():
        dest = pefa_dir / spec["zip_name"]
        out[fw] = _download_one(spec["url"], dest, force=force)
    return out


# ─────────────────────────────────────────────
# PARSE
# ─────────────────────────────────────────────

def _read_framework_csv(zip_path: Path, csv_rel_path: str) -> pd.DataFrame:
    """Extract and read the Data.csv from a PEFA ZIP."""
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(csv_rel_path) as fh:
            df = pd.read_csv(fh)
    df.columns = [str(c).strip() for c in df.columns]
    return df


def _melt_wide_to_long(wide: pd.DataFrame, framework: str) -> pd.DataFrame:
    """
    Convert a PEFA wide CSV to long format.

    Returns rows with columns:
      iso3, country_name, year, indicator_code_raw, score
    where `year` is the assessment year (extracted from YYYYMM column name)
    and `indicator_code_raw` is the original PI-XX[.Y] code from PEFA.
    """
    required = {"Country Name", "Country Code", "Indicator Code"}
    missing = required - set(wide.columns)
    if missing:
        raise ValueError(f"PEFA CSV is missing required columns: {missing}")

    date_cols = [c for c in wide.columns if c.isdigit() and len(c) == 6]
    if not date_cols:
        raise ValueError(f"PEFA CSV has no YYYYMM date columns (got {list(wide.columns)[:10]}...)")

    long = wide.melt(
        id_vars=["Country Name", "Country Code", "Indicator Code"],
        value_vars=date_cols,
        var_name="assessment_yyyymm",
        value_name="score",
    )
    long["score"] = pd.to_numeric(long["score"], errors="coerce")
    long = long.dropna(subset=["score", "Country Code", "Indicator Code"])

    long["year"] = long["assessment_yyyymm"].str[:4].astype(int)
    long = long.rename(columns={
        "Country Name": "country_name",
        "Country Code": "iso3_raw",
        "Indicator Code": "indicator_code_raw",
    })
    long["iso3"] = long["iso3_raw"].astype(str).str.strip().str.upper().apply(
        lambda c: standardise_iso3(c, WB_TO_ISO3)
    )
    # The 2011 bulk includes subnational entries (non-ISO codes). Keep only
    # 3-char ISO codes; log anything dropped so it's visible.
    bad = long[long["iso3"].str.len() != 3]
    if not bad.empty:
        dropped = bad["iso3_raw"].unique()[:10]
        logger.info(
            "PEFA %s: dropping %d rows with non-ISO country codes (e.g. %s)",
            framework, len(bad), list(dropped),
        )
        long = long[long["iso3"].str.len() == 3]

    # If a single (iso3, year, indicator) has multiple assessments in the same
    # year (rare — e.g. a subnational and a national reassessment), keep the
    # one with the latest month.
    long = (long
            .sort_values(["iso3", "indicator_code_raw", "year", "assessment_yyyymm"])
            .drop_duplicates(subset=["iso3", "indicator_code_raw", "year"], keep="last"))

    return long[["iso3", "country_name", "year", "indicator_code_raw", "score"]].reset_index(drop=True)


def _compute_pillar_averages(long: pd.DataFrame, framework: str) -> pd.DataFrame:
    """
    Compute derived pillar-level averages from top-level PI scores.

    Returns additional rows in the same schema as `long`, with
    indicator_code_raw set to synthetic codes (e.g. "PILLAR3_AVG",
    "BUDGET_RELIAB_AVG", "OVERALL_AVG").
    """
    # Keep only top-level PI scores (no dimensions like PI-01.1)
    top = long[~long["indicator_code_raw"].str.contains(r"\.")].copy()
    # Extract PI number
    top["pi_num"] = (
        top["indicator_code_raw"]
        .str.extract(r"PI-(\d+)$", expand=False)
        .astype("Int64")
    )
    top = top.dropna(subset=["pi_num"])
    top["pi_num"] = top["pi_num"].astype(int)

    pillars = PEFA16_PILLARS if framework == "2016" else PEFA11_PILLARS
    all_pi_nums = sorted({n for nums in pillars.values() for n in nums})

    derived_frames: list[pd.DataFrame] = []

    def _avg(df: pd.DataFrame, pi_nums: list[int], code: str) -> pd.DataFrame:
        sub = df[df["pi_num"].isin(pi_nums)]
        if sub.empty:
            return pd.DataFrame()
        agg = (sub.groupby(["iso3", "country_name", "year"], as_index=False)
                  .agg(score=("score", "mean"), n=("score", "size")))
        # Require at least half the pillar's PIs to be present to avoid noisy averages
        min_required = max(1, len(pi_nums) // 2)
        agg = agg[agg["n"] >= min_required]
        agg["indicator_code_raw"] = code
        return agg[["iso3", "country_name", "year", "indicator_code_raw", "score"]]

    for pillar_code, pi_nums in pillars.items():
        out = _avg(top, pi_nums, f"{pillar_code}_AVG")
        if not out.empty:
            derived_frames.append(out)

    # Overall = unweighted mean of all PIs
    overall = _avg(top, all_pi_nums, "OVERALL_AVG")
    if not overall.empty:
        derived_frames.append(overall)

    if not derived_frames:
        return pd.DataFrame(columns=long.columns)
    return pd.concat(derived_frames, ignore_index=True)


def _to_standard_schema(
    raw_and_derived: pd.DataFrame,
    framework: str,
    pulled_at: str,
) -> pd.DataFrame:
    """Map PEFA long rows to the project's standard schema."""
    prefix = f"PEFA{framework[-2:]}_"   # PEFA16_ or PEFA11_
    out = raw_and_derived.copy()
    out["indicator_code"] = prefix + out["indicator_code_raw"].astype(str)
    out["indicator_name"] = out["indicator_code_raw"].astype(str).apply(
        lambda c: _indicator_name(c, framework)
    )
    out["value"] = out["score"].astype(float)
    out["source"] = f"PEFA {framework}"
    out["pulled_at"] = pulled_at
    return out[[
        "iso3", "country_name", "year",
        "indicator_code", "indicator_name",
        "value", "source", "pulled_at",
    ]]


_PILLAR_HUMAN_NAMES = {
    "BUDGET_RELIAB":  "PEFA pillar average — Budget reliability (PI-1..PI-3)",
    "TRANSPARENCY":   "PEFA pillar average — Transparency of public finances",
    "ASSETS_LIAB":    "PEFA pillar average — Management of assets and liabilities",
    "FISCAL_POLICY":  "PEFA pillar average — Policy-based fiscal strategy & budgeting",
    "PILLAR3":        "PEFA pillar average — Predictability and Control in Budget Execution (PI-19..PI-26)",
    "ACCOUNTING":     "PEFA pillar average — Accounting and reporting",
    "AUDIT":          "PEFA pillar average — External scrutiny and audit",
    "POLICY_BUDGET":  "PEFA pillar average — Policy-based budgeting (2011 framework)",
    "PCBE":           "PEFA pillar average — Predictability and Control in Budget Execution (2011, PI-13..PI-21)",
    "OVERALL":        "PEFA average across all performance indicators",
}


def _indicator_name(raw_code: str, framework: str) -> str:
    """Human-readable label for a PEFA raw code."""
    if raw_code.endswith("_AVG"):
        stem = raw_code[:-4]
        return _PILLAR_HUMAN_NAMES.get(stem, f"PEFA {framework} derived average — {stem}")
    if "." in raw_code:
        return f"PEFA {framework} dimension score {raw_code} (0–4 scale)"
    return f"PEFA {framework} performance indicator {raw_code} (0–4 scale)"


# ─────────────────────────────────────────────
# PUBLIC ENTRY POINT
# ─────────────────────────────────────────────

def process_pefa(
    save: bool = True,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    auto_download: bool = True,
    force_download: bool = False,
) -> pd.DataFrame:
    """
    Download and process the PEFA 2011 and 2016 bulk datasets into the
    project's standard long-format schema.

    Args:
        save:           Persist to PROCESSED_DIR/pefa.parquet.
        start_year:     Drop assessments before this year.
        end_year:       Drop assessments after this year.
        auto_download:  Fetch from World Bank Databank if cache is stale/missing.
        force_download: Always re-download, ignoring cache.

    Returns:
        Long-format DataFrame matching STANDARD_COLUMNS. One row per
        (iso3, year, indicator_code, source) — source distinguishes 2011 vs
        2016 framework so the two do not collide in master.parquet.
    """
    print(f"\n{'='*60}")
    print(f" PEFA  —  Download + process (2011 + 2016 frameworks)")
    print(f"{'='*60}")

    pulled_at = now_utc()
    pefa_dir = Path(MANUAL_DIR) / PEFA_DIR_NAME

    if auto_download:
        paths = download_pefa(force=force_download)
    else:
        paths = {fw: pefa_dir / spec["zip_name"] for fw, spec in PEFA_FILES.items()}
        for fw, p in paths.items():
            if not p.exists():
                raise PEFADownloadError(
                    f"PEFA {fw} file missing at {p} and auto_download=False. "
                    f"Download from {PEFA_FILES[fw]['url']}."
                )
            _validate_zip(p)

    frames: list[pd.DataFrame] = []
    for fw, zip_path in paths.items():
        csv_rel = PEFA_FILES[fw]["csv_path"]
        logger.info("Parsing PEFA %s framework: %s", fw, zip_path)
        wide = _read_framework_csv(zip_path, csv_rel)
        long = _melt_wide_to_long(wide, fw)
        if long.empty:
            logger.warning("PEFA %s produced zero rows after melt.", fw)
            continue
        derived = _compute_pillar_averages(long, fw)
        combined = pd.concat([long, derived], ignore_index=True)
        std = _to_standard_schema(combined, fw, pulled_at)
        # Year filter
        std = std[(std["year"] >= start_year) & (std["year"] <= end_year)]
        frames.append(std)
        print(f"  PEFA {fw}: {std['iso3'].nunique()} countries | "
              f"{std['indicator_code'].nunique()} indicators | {len(std):,} rows | "
              f"years {int(std['year'].min())}–{int(std['year'].max())}")

    if not frames:
        logger.warning("No PEFA data ingested.")
        return pd.DataFrame(columns=[
            "iso3", "country_name", "year",
            "indicator_code", "indicator_name",
            "value", "source", "pulled_at",
        ])

    df = pd.concat(frames, ignore_index=True)
    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    print(f"\n  Total records:    {len(df):,}")
    print(f"  Countries:        {df['iso3'].nunique():,}")
    print(f"  Indicators:       {df['indicator_code'].nunique():,}")
    print(f"  Year range:       {int(df['year'].min())}–{int(df['year'].max())}")

    if save and not df.empty:
        save_data(df, "pefa", PROCESSED_DIR)

    return df


if __name__ == "__main__":
    from .utils import configure_logging
    configure_logging()
    process_pefa()
