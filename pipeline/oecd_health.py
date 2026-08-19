"""
oecd_health.py — Process OECD Health Statistics data.

Source:   Organisation for Economic Co-operation and Development (OECD)
          https://stats.oecd.org/  →  Health  →  Health Statistics
Coverage: 38 OECD member countries + key partners, 1970–2023
License:  OECD Terms and Conditions (free for non-commercial use)

HOW TO DOWNLOAD (one-time, ~5 minutes):
────────────────────────────────────────
1. Go to:  https://stats.oecd.org/
2. In the left menu expand: Health → Health Statistics
3. Select "Health Status" — then click "Customise" to add more datasets:
     • Health expenditure and financing  (HEALTH_STAT)
     • Health Care Resources             (HEALTH_REAC)
     • Health Care Utilisation           (HEALTH_PROC)
     • Health Status                     (HEALTH_STAT / HEALTH_LVNG)
     • Social Protection                 (SOCX_AGG)
4. Select:
     - Countries: All OECD + partner countries
     - Years:     All available years
     - Variables: All (or choose specific ones)
5. Click "Export" → "CSV (for Excel)" or "Plain CSV"
6. Save the file as:
       data/manual_downloads/oecd_health.csv
   (If you have multiple files, save them all in the same directory
    and set directory= in process_oecd_health())

Alternatively, download the pre-formatted export directly:
  https://stats.oecd.org/DownloadFiles.aspx?HideTopMenu=yes&DatasetCode=HEALTH_STAT

Why manual? OECD's bulk CSV export covers all indicators in one file;
the JSON API is rate-limited and has incomplete variable metadata.

Indicators captured (examples — depends on what you export):
  OECD_HLTH_EXPENDITURE     Total health expenditure (% GDP, per capita, etc.)
  OECD_HLTH_DOCTORS         Practising physicians (per 1,000 population)
  OECD_HLTH_BEDS            Hospital beds (per 1,000 population)
  OECD_HLTH_LIFEEXP         Life expectancy at birth
  OECD_HLTH_INFANT_MORT     Infant mortality rate
"""

import os
import glob as glob_module

import pandas as pd

from .config import PROCESSED_DIR, MANUAL_DIR, START_YEAR, END_YEAR
from .utils  import get_country_name, save_data, now_utc, make_standard_df

OECD_DIR          = os.path.join(MANUAL_DIR)
OECD_FILENAME_CSV = "oecd_health.csv"
OECD_FILENAME_XLS = "oecd_health.xlsx"

# OECD country codes are ISO 3-letter (mostly) but a few differ
OECD_CODE_MAP = {
    "CZE": "CZE",  # Czechia (OECD sometimes uses "CZE")
    "KOR": "KOR",  # Korea
    "SVK": "SVK",  # Slovak Republic
    "MKD": "MKD",  # North Macedonia (partner)
}

# ── Column name candidates (OECD export format varies by dataset) ──
# The OECD .stat CSV export has these column patterns:
_COL_CANDIDATES = {
    "country": ["country", "cou", "location", "reporter_country", "country_code",
                "referencearea", "ref_area"],
    "variable": ["variable", "var", "indicator", "measure", "subject", "series",
                 "var_desc", "variable_desc", "indicator_name"],
    "year":     ["year", "time", "period", "time_period", "year_period"],
    "value":    ["value", "obs_value", "obsvalue", "val"],
    "unit":     ["unit", "unit_code", "unitcode", "measure"],
}


def _find_col(df: pd.DataFrame, candidates: list) -> str:
    """Return the first candidate column name present in df, or ''."""
    for c in candidates:
        if c in df.columns:
            return c
    return ""


def _clean_indicator_code(raw_name: str) -> str:
    """Convert a variable name to a safe indicator code."""
    import re
    safe = re.sub(r"[^A-Z0-9]+", "_", raw_name.upper()).strip("_")
    return f"OECD_HLTH_{safe[:50]}"


def _load_file(fpath: str) -> pd.DataFrame:
    """Load a CSV or Excel file, normalising column names."""
    ext = os.path.splitext(fpath)[1].lower()
    try:
        if ext in (".xlsx", ".xls"):
            df = pd.read_excel(fpath)
        else:
            # OECD CSVs are sometimes encoded in latin-1
            for enc in ("utf-8", "latin-1", "cp1252"):
                try:
                    df = pd.read_csv(fpath, encoding=enc, low_memory=False)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise ValueError(f"Could not decode {fpath}")
    except Exception as e:
        raise RuntimeError(f"Failed to load {fpath}: {e}")

    df.columns = [str(c).strip().lower().replace(" ", "_").replace("-", "_")
                  for c in df.columns]
    return df


def process_oecd_health(
    filepath:   str  = None,
    save:       bool = True,
    start_year: int  = START_YEAR,
    end_year:   int  = END_YEAR,
) -> pd.DataFrame:
    """
    Process the downloaded OECD Health Statistics file(s) into
    the standard long format.

    Args:
        filepath:   Path to a single CSV/Excel file, or a directory
                    containing multiple OECD CSV files.
                    Defaults to data/manual_downloads/oecd_health.csv
        save:       If True, save results to processed/ directory.
        start_year: Filter to years >= start_year.
        end_year:   Filter to years <= end_year.

    Returns:
        Standardised long-format DataFrame, or empty DataFrame if
        the file has not been downloaded yet.
    """
    print(f"\n{'='*60}")
    print(f" OECD HEALTH STATISTICS  —  Processing manual download")
    print(f"{'='*60}")

    # Resolve file path(s)
    if filepath is None:
        # Try default CSV then Excel
        csv_default = os.path.join(OECD_DIR, OECD_FILENAME_CSV)
        xls_default = os.path.join(OECD_DIR, OECD_FILENAME_XLS)
        if os.path.exists(csv_default):
            filepath = csv_default
        elif os.path.exists(xls_default):
            filepath = xls_default
        else:
            _print_download_instructions(csv_default)
            return pd.DataFrame()

    # Build list of files to process
    if os.path.isdir(filepath):
        files = (
            glob_module.glob(os.path.join(filepath, "*.csv")) +
            glob_module.glob(os.path.join(filepath, "*.xlsx"))
        )
        if not files:
            _print_download_instructions(filepath)
            return pd.DataFrame()
    else:
        if not os.path.exists(filepath):
            _print_download_instructions(filepath)
            return pd.DataFrame()
        files = [filepath]

    print(f"  Found {len(files)} file(s)")
    pulled_at   = now_utc()
    all_records = []
    unknown_vars = set()

    for fpath in files:
        print(f"  Loading {os.path.basename(fpath)}...")
        try:
            df_raw = _load_file(fpath)
        except RuntimeError as e:
            print(f"  ✗ {e}")
            continue

        # Identify key columns
        country_col  = _find_col(df_raw, _COL_CANDIDATES["country"])
        variable_col = _find_col(df_raw, _COL_CANDIDATES["variable"])
        year_col     = _find_col(df_raw, _COL_CANDIDATES["year"])
        value_col    = _find_col(df_raw, _COL_CANDIDATES["value"])

        missing = [name for name, col in
                   [("country", country_col), ("variable", variable_col),
                    ("year", year_col), ("value", value_col)]
                   if not col]
        if missing:
            print(f"  ✗ Could not identify columns: {missing}")
            print(f"     Available columns: {list(df_raw.columns)}")
            print(f"     Please check the file format and update oecd_health.py if needed.")
            continue

        # Optional: variable description / unit
        desc_col = _find_col(df_raw, ["var_desc", "variable_desc", "indicator_desc",
                                       "var_description", "indicator_description"])
        unit_col = _find_col(df_raw, _COL_CANDIDATES["unit"])

        # Filter to years in range
        df_raw[year_col] = pd.to_numeric(df_raw[year_col], errors="coerce")
        df_raw = df_raw[
            (df_raw[year_col] >= start_year) &
            (df_raw[year_col] <= end_year)
        ]

        for _, row in df_raw.iterrows():
            raw_country = str(row[country_col]).strip().upper()
            # OECD codes are typically 3-letter ISO
            iso3 = OECD_CODE_MAP.get(raw_country, raw_country)
            if len(iso3) != 3 or not iso3.isalpha():
                continue

            raw_var = str(row[variable_col]).strip()
            if not raw_var:
                unknown_vars.add(raw_var)
                continue

            # Build human-readable name
            if desc_col:
                ind_name = str(row.get(desc_col, raw_var)).strip()
            else:
                ind_name = raw_var

            if unit_col:
                unit = str(row.get(unit_col, "")).strip()
                if unit and unit.lower() not in ("nan", "", "index"):
                    ind_name = f"{ind_name} ({unit})"

            try:
                value = float(row[value_col])
                year  = int(row[year_col])
            except (TypeError, ValueError):
                continue

            all_records.append({
                "iso3":           iso3,
                "country_name":   get_country_name(iso3),
                "year":           year,
                "indicator_code": _clean_indicator_code(raw_var),
                "indicator_name": ind_name,
                "value":          value,
                "source":         "OECD",
                "pulled_at":      pulled_at,
            })

    if not all_records:
        print("  ✗ No records extracted — check file format and column names.")
        return pd.DataFrame()

    df = make_standard_df(all_records)
    print(f"\n  Total records: {len(df):,}")
    print(f"  Countries:     {df['iso3'].nunique()}")
    print(f"  Indicators:    {df['indicator_code'].nunique()}")

    if save and not df.empty:
        save_data(df, "oecd_health", PROCESSED_DIR)

    return df


def _print_download_instructions(path_hint: str) -> None:
    print(f"\n  ⚠  OECD Health Statistics file not found.")
    print(f"     Expected at: {path_hint}")
    print(f"\n  Please download the data manually:")
    print(f"  1. Go to https://stats.oecd.org/")
    print(f"  2. Navigate to: Health → Health Statistics")
    print(f"  3. Select all countries and years, then:")
    print(f"     Click Export → CSV (for Excel)")
    print(f"  4. Save the file as:")
    print(f"     {os.path.join(MANUAL_DIR, OECD_FILENAME_CSV)}")
    print(f"\n  Alternatively, use the direct download URL:")
    print(f"  https://stats.oecd.org/DownloadFiles.aspx?DatasetCode=HEALTH_STAT")
    print(f"\n  Skipping OECD — all other sources will still run.")
