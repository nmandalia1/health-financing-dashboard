"""
ihme_fgh.py — Process IHME Financing Global Health (FGH) data.

Source:   Institute for Health Metrics and Evaluation (IHME)
VizHub:   https://vizhub.healthdata.org/fgh/
GHDx:     https://ghdx.healthdata.org/series/financing-global-health-fgh
Coverage: 195+ recipient countries, 1990–2021 (updated ~annually)
License:  IHME Free-for-Academic-Use License

NOTE ON THE VIZHUB API:
  The FGH VizHub (https://vizhub.healthdata.org/fgh/) loads data
  from a protected Azure AD backend (ihmecsu.onmicrosoft.com/data-api).
  There is no public API — all programmatic access requires authentication.
  The GHDx bulk download (below) is the correct route for pipeline use.

HOW TO DOWNLOAD (one-time, ~5 minutes):
────────────────────────────────────────
1. Go to:  https://ghdx.healthdata.org/series/financing-global-health-fgh
2. Click the most recent FGH record (e.g. "Financing Global Health 2022")
3. On the record page, click "Download" next to the data file
   (usually named something like "IHME_FGH_2022_DATA_Y####.csv"
    or a ZIP containing multiple CSVs)
4. Extract if zipped, then save the main data CSV as:
       data/manual_downloads/ihme_fgh/IHME_FGH_DATA.csv
   (Any CSV matching ihme_fgh_*.csv or IHME_FGH_*.csv will be found)

What the data contains:
  - Development Assistance for Health (DAH): funding flows by source
    country/organisation → recipient country → health focus area
  - Domestic Government Health Expenditure (GGHE-D)
  - Prepaid Private Health Spending
  - Out-of-pocket health spending
  All values in 2021 USD, disaggregated by financing channel and health cause.

Indicators produced (examples):
  IHME_FGH_DAH_TOTAL_2021USD       Total DAH received (2021 USD millions)
  IHME_FGH_DAH_HIV_2021USD         DAH for HIV/AIDS (2021 USD millions)
  IHME_FGH_DAH_MALARIA_2021USD     DAH for Malaria (2021 USD millions)
  IHME_FGH_DAH_TB_2021USD          DAH for Tuberculosis (2021 USD millions)
  IHME_FGH_DAH_BILATERAL_2021USD   DAH via bilateral channels
  IHME_FGH_GGHE_2021USD            Domestic govt health expenditure (2021 USD)
  IHME_FGH_OOP_2021USD             Out-of-pocket health spending (2021 USD)
  IHME_FGH_PPP_2021USD             Prepaid private health spending (2021 USD)
"""

import os
import re
import glob as glob_module

import pandas as pd

from .config import PROCESSED_DIR, MANUAL_DIR, START_YEAR, END_YEAR
from .utils  import get_country_name, save_data, now_utc, make_standard_df

FGH_DIR = os.path.join(MANUAL_DIR, "ihme_fgh")

# FGH typical column names (vary slightly between publication years)
_COL_CANDIDATES = {
    "recipient_iso3":  ["iso3", "recipient_iso3", "ihme_loc_id", "location_id",
                        "recipient_country_iso3", "country_iso"],
    "recipient_name":  ["recipient_country", "location_name", "country_name"],
    "year":            ["year", "yr", "period"],
    "value":           ["mean", "val", "value", "dah_21", "dah_19", "amount"],
    "health_focus":    ["health_focus_area", "health_focus", "cause",
                        "cause_name", "focus_area", "component"],
    "channel":         ["channel", "source_type", "source_channel",
                        "financing_channel"],
    "spending_type":   ["spending_type", "type", "indicator", "measure",
                        "variable", "series"],
}


def _find_col(df: pd.DataFrame, candidates: list) -> str:
    """Return first matching candidate column, or ''."""
    for c in candidates:
        if c in df.columns:
            return c
    return ""


def _safe_code(label: str, prefix: str = "", max_len: int = 40) -> str:
    """Convert a label to a safe uppercase indicator code segment."""
    safe = re.sub(r"[^A-Z0-9]+", "_", label.upper()).strip("_")
    if prefix:
        return f"{prefix}_{safe[:max_len]}"
    return safe[:max_len]


def process_ihme_fgh(
    directory:  str  = None,
    save:       bool = True,
    start_year: int  = START_YEAR,
    end_year:   int  = END_YEAR,
) -> pd.DataFrame:
    """
    Process downloaded IHME FGH CSV file(s) into the standard long format.

    Produces one row per (recipient_country, year, indicator) combination.
    Indicators are constructed from the health_focus/channel dimensions
    present in the data.

    Args:
        directory:  Directory containing IHME FGH CSV files.
                    Defaults to data/manual_downloads/ihme_fgh/
        save:       If True, save results to processed/ directory.
        start_year: Filter to years >= start_year.
        end_year:   Filter to years <= end_year.

    Returns:
        Standardised long-format DataFrame, or empty DataFrame if
        files have not been downloaded yet.
    """
    if directory is None:
        directory = FGH_DIR

    print(f"\n{'='*60}")
    print(f" IHME FGH  —  Processing Financing Global Health download")
    print(f"{'='*60}")

    if not os.path.isdir(directory):
        _print_instructions(directory)
        return pd.DataFrame()

    csv_files = glob_module.glob(os.path.join(directory, "*.csv"))
    if not csv_files:
        _print_instructions(directory)
        return pd.DataFrame()

    print(f"  Found {len(csv_files)} CSV file(s)")
    pulled_at   = now_utc()
    all_records = []
    skipped_rows = 0

    for fpath in csv_files:
        print(f"  Loading {os.path.basename(fpath)}...")
        try:
            df_raw = pd.read_csv(fpath, low_memory=False)
        except Exception as e:
            print(f"  ✗ Could not read {os.path.basename(fpath)}: {e}")
            continue

        # Normalise column names
        df_raw.columns = [str(c).strip().lower().replace(" ", "_").replace("-", "_")
                          for c in df_raw.columns]

        # Identify columns
        iso3_col     = _find_col(df_raw, _COL_CANDIDATES["recipient_iso3"])
        name_col     = _find_col(df_raw, _COL_CANDIDATES["recipient_name"])
        year_col     = _find_col(df_raw, _COL_CANDIDATES["year"])
        value_col    = _find_col(df_raw, _COL_CANDIDATES["value"])
        focus_col    = _find_col(df_raw, _COL_CANDIDATES["health_focus"])
        channel_col  = _find_col(df_raw, _COL_CANDIDATES["channel"])
        type_col     = _find_col(df_raw, _COL_CANDIDATES["spending_type"])

        missing = [name for name, col in
                   [("iso3", iso3_col), ("year", year_col), ("value", value_col)]
                   if not col]
        if missing:
            print(f"  ✗ Could not identify required columns: {missing}")
            print(f"     Available: {list(df_raw.columns)}")
            print(f"     Please update ihme_fgh.py column candidates if needed.")
            continue

        # Filter year range
        df_raw[year_col] = pd.to_numeric(df_raw[year_col], errors="coerce")
        df_raw = df_raw[
            (df_raw[year_col] >= start_year) &
            (df_raw[year_col] <= end_year)
        ]

        for _, row in df_raw.iterrows():
            iso3 = str(row[iso3_col]).strip().upper()
            # Skip aggregates (non-ISO3 codes, regional, global)
            if len(iso3) != 3 or not iso3.isalpha():
                skipped_rows += 1
                continue

            try:
                value = float(row[value_col])
                year  = int(row[year_col])
            except (TypeError, ValueError):
                skipped_rows += 1
                continue

            country_nm = str(row[name_col]).strip() if name_col else get_country_name(iso3)

            # Build indicator code from available dimensions
            focus   = str(row[focus_col]).strip()   if focus_col   else "ALL"
            channel = str(row[channel_col]).strip() if channel_col else ""
            sptype  = str(row[type_col]).strip()    if type_col    else "DAH"

            # Primary dimension: spending type (DAH, GGHE, OOP, PPP, etc.)
            code_parts = ["IHME_FGH", _safe_code(sptype, max_len=20)]
            if focus and focus.upper() not in ("ALL", "ALL_CAUSES", "NAN", ""):
                code_parts.append(_safe_code(focus, max_len=20))
            if channel and channel.upper() not in ("ALL", "TOTAL", "NAN", ""):
                code_parts.append(_safe_code(channel, max_len=15))
            code_parts.append("2021USD")

            ind_code = "_".join(code_parts)

            # Build human-readable name
            parts = [sptype or "Development Assistance for Health"]
            if focus and focus.upper() not in ("ALL", "ALL_CAUSES", "NAN", ""):
                parts.append(f"— {focus}")
            if channel and channel.upper() not in ("ALL", "TOTAL", "NAN", ""):
                parts.append(f"[{channel}]")
            parts.append("(2021 USD millions)")
            ind_name = " ".join(parts)

            all_records.append({
                "iso3":           iso3,
                "country_name":   country_nm or get_country_name(iso3),
                "year":           year,
                "indicator_code": ind_code,
                "indicator_name": ind_name,
                "value":          value,
                "source":         "IHME FGH",
                "pulled_at":      pulled_at,
            })

    if not all_records:
        print("  ✗ No records extracted — check file format and column names.")
        return pd.DataFrame()

    if skipped_rows:
        print(f"  ⚠ Skipped {skipped_rows:,} rows (aggregates, nulls, or bad values)")

    # Aggregate: FGH can have multiple rows per (country, year, indicator)
    # if the same spending type appears across multiple channels/sources.
    # Sum to get country-year totals per indicator.
    df = make_standard_df(all_records)

    df = (
        df.groupby(
            ["iso3", "country_name", "year", "indicator_code",
             "indicator_name", "source", "pulled_at"],
            as_index=False,
        )["value"].sum()
    )

    df = df.sort_values(["iso3", "indicator_code", "year"]).reset_index(drop=True)

    print(f"\n  Total records: {len(df):,}")
    print(f"  Countries:     {df['iso3'].nunique()}")
    print(f"  Indicators:    {df['indicator_code'].nunique()}")

    if save and not df.empty:
        save_data(df, "ihme_fgh", PROCESSED_DIR)

    return df


def _print_instructions(directory: str) -> None:
    print(f"\n  ⚠  IHME FGH files not found at:")
    print(f"     {directory}")
    print(f"\n  NOTE: The FGH VizHub (https://vizhub.healthdata.org/fgh/) uses")
    print(f"  a protected Azure AD API (not publicly accessible).")
    print(f"  Use the GHDx bulk download instead:")
    print(f"\n  1. Go to: https://ghdx.healthdata.org/series/financing-global-health-fgh")
    print(f"  2. Click the most recent FGH record")
    print(f"  3. Click 'Download' to get the data CSV (or ZIP)")
    print(f"  4. Extract and save any CSVs to:")
    print(f"     {directory}")
    print(f"\n  Skipping IHME FGH — all other sources will still run.")
