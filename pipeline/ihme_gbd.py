"""
ihme_gbd.py — Process IHME Global Burden of Disease (GBD) data.

Source:   Institute for Health Metrics and Evaluation (IHME)
          https://ghdx.healthdata.org/gbd-results
Coverage: 204 countries, 1990–2021 (updated ~every 2 years)
License:  IHME Free-for-Academic-Use License

HOW TO DOWNLOAD (one-time, ~5–10 minutes):
───────────────────────────────────────────
1. Go to:  https://ghdx.healthdata.org/gbd-results
2. Select the following filters:
     Base:     GBD 2021 (or latest available)
     Measure:  Deaths, DALYs, Incidence, Prevalence, YLDs, YLLs
     Metric:   Rate (per 100,000), Number, Percent
     Age:      Age-standardized  AND  All ages
     Sex:      Both
     Location: All countries and territories
     Cause:    All causes  (optionally add specific cause groups)
     Year:     All years
3. Click "Download" — you'll receive a .zip with CSV files inside
4. Extract all CSV files into one folder and save that folder as:
       data/manual_downloads/ihme_gbd/
   (Each CSV will be named something like IHME-GBD_2021_DATA-xxxxx.csv)

Then run process_ihme_gbd() to load and standardise the data.

Why manual? IHME's data API requires registration and has usage limits.
The bulk download is free and covers everything in one go.

Indicators captured (from whichever measures you downloaded):
  IHME_DEATHS_ALL_RATE         All-cause mortality rate (per 100,000)
  IHME_DALYS_ALL_RATE          All-cause DALYs (per 100,000)
  IHME_DEATHS_<CAUSE>_RATE     Cause-specific mortality rates
  IHME_DALYS_<CAUSE>_RATE      Cause-specific DALY rates
  (and Number / Percent variants if downloaded)
"""

import os
import re
import glob as glob_module

import pandas as pd

from .config import PROCESSED_DIR, MANUAL_DIR, START_YEAR, END_YEAR
from .utils  import get_country_name, save_data, now_utc, make_standard_df

IHME_DIR      = os.path.join(MANUAL_DIR, "ihme_gbd")
IHME_FILENAME = "IHME_GBD_*.csv"   # glob pattern — handles multiple CSV files

# Which GBD measures to keep (matches the 'measure_name' column)
KEEP_MEASURES = {
    "Deaths":     "DEATHS",
    "DALYs (Disability-Adjusted Life Years)": "DALYS",
    "Incidence":  "INCIDENCE",
    "Prevalence": "PREVALENCE",
    "YLDs (Years Lived with Disability)": "YLDS",
    "YLLs (Years of Life Lost)": "YLLS",
}

# Which metrics to keep ('metric_name' column)
KEEP_METRICS = {
    "Rate":    "RATE",
    "Number":  "NUM",
    "Percent": "PCT",
}

# Which age groups to keep ('age_name' column)
# Age-standardized is preferred for cross-country comparisons
KEEP_AGES = {
    "Age-standardized":  "AGESTD",
    "All ages":          "ALLAGES",
}

# GBD uses location names, not ISO codes — we map via pycountry
# A few common exceptions where GBD name differs from pycountry
GBD_NAME_OVERRIDES = {
    "Bolivia (Plurinational State of)":   "BOL",
    "Côte d'Ivoire":                      "CIV",
    "Democratic People's Republic of Korea": "PRK",
    "Democratic Republic of the Congo":   "COD",
    "Iran (Islamic Republic of)":         "IRN",
    "Lao People's Democratic Republic":   "LAO",
    "Micronesia (Federated States of)":   "FSM",
    "Republic of Moldova":                "MDA",
    "Russian Federation":                 "RUS",
    "Syrian Arab Republic":               "SYR",
    "Tanzania, United Republic of":       "TZA",
    "United Kingdom of Great Britain and Northern Ireland": "GBR",
    "United Republic of Tanzania":        "TZA",
    "United States of America":           "USA",
    "Venezuela (Bolivarian Republic of)": "VEN",
    "Viet Nam":                           "VNM",
    "West Bank and Gaza":                 "PSE",
    # GBD sometimes uses these spellings
    "Taiwan (Province of China)":         "TWN",
    "Hong Kong Special Administrative Region of China": "HKG",
    "Macao Special Administrative Region of China":     "MAC",
}


def _location_to_iso3(location_name: str, cache: dict) -> str:
    """Convert a GBD location name to ISO3 code (with caching)."""
    if location_name in cache:
        return cache[location_name]

    # Check manual overrides first
    if location_name in GBD_NAME_OVERRIDES:
        iso3 = GBD_NAME_OVERRIDES[location_name]
        cache[location_name] = iso3
        return iso3

    # Try pycountry fuzzy search
    import pycountry
    try:
        result = pycountry.countries.search_fuzzy(location_name)
        if result:
            iso3 = result[0].alpha_3
            cache[location_name] = iso3
            return iso3
    except Exception:
        pass

    # Return empty string — will be filtered out
    cache[location_name] = ""
    return ""


def _make_indicator_code(measure_short: str, cause: str, metric_short: str, age_short: str) -> str:
    """
    Build a standardised indicator code from GBD components.
    Example: IHME_DEATHS_ALL_CAUSES_RATE_AGESTD
    """
    # Sanitise cause name: uppercase, replace spaces/special chars with underscore
    safe_cause = re.sub(r"[^A-Z0-9]+", "_", cause.upper()).strip("_")
    safe_cause = safe_cause[:40]  # cap length
    return f"IHME_{measure_short}_{safe_cause}_{metric_short}_{age_short}"


def _make_indicator_name(measure: str, cause: str, metric: str, age: str) -> str:
    return f"IHME GBD — {measure}, {cause} ({metric}, {age})"


def process_ihme_gbd(
    directory:  str  = None,
    save:       bool = True,
    start_year: int  = START_YEAR,
    end_year:   int  = END_YEAR,
) -> pd.DataFrame:
    """
    Process downloaded IHME GBD CSV files into the standard long format.

    Args:
        directory:  Path containing the GBD CSV files.
                    Defaults to data/manual_downloads/ihme_gbd/
        save:       If True, save results to processed/ directory.
        start_year: Filter to years >= start_year.
        end_year:   Filter to years <= end_year.

    Returns:
        Standardised long-format DataFrame, or empty DataFrame if
        files have not been downloaded yet.
    """
    if directory is None:
        directory = IHME_DIR

    print(f"\n{'='*60}")
    print(f" IHME GBD  —  Processing manual download")
    print(f"{'='*60}")

    if not os.path.isdir(directory):
        _print_download_instructions(directory)
        return pd.DataFrame()

    csv_files = glob_module.glob(os.path.join(directory, "*.csv"))
    if not csv_files:
        _print_download_instructions(directory)
        return pd.DataFrame()

    print(f"  Found {len(csv_files)} CSV file(s) in {directory}")
    pulled_at = now_utc()
    iso3_cache = {}
    all_records = []
    skipped_locations = set()

    for fpath in csv_files:
        print(f"  Loading {os.path.basename(fpath)}...")
        try:
            df_raw = pd.read_csv(fpath, low_memory=False)
        except Exception as e:
            print(f"  ✗ Could not read {os.path.basename(fpath)}: {e}")
            continue

        # Normalise column names
        df_raw.columns = [str(c).strip().lower().replace(" ", "_") for c in df_raw.columns]

        # Expected columns (GBD standard export):
        # measure_name, location_name, sex_name, age_name, cause_name,
        # metric_name, year, val, upper, lower
        required = {"measure_name", "location_name", "sex_name",
                    "age_name", "metric_name", "year", "val"}
        missing = required - set(df_raw.columns)
        if missing:
            print(f"  ✗ Missing expected columns: {missing}")
            print(f"     Got: {list(df_raw.columns)}")
            continue

        # Determine cause column name (may vary slightly between GBD versions)
        cause_col = next(
            (c for c in ["cause_name", "cause", "rei_name"] if c in df_raw.columns),
            None,
        )

        # Filter to Both sexes only
        df_raw = df_raw[df_raw["sex_name"].str.lower().isin(["both", "both sexes"])]

        # Filter to selected age groups
        df_raw = df_raw[df_raw["age_name"].isin(KEEP_AGES.keys())]

        # Filter to selected measures
        df_raw = df_raw[df_raw["measure_name"].isin(KEEP_MEASURES.keys())]

        # Filter to selected metrics
        df_raw = df_raw[df_raw["metric_name"].isin(KEEP_METRICS.keys())]

        # Filter year range
        df_raw = df_raw[
            (pd.to_numeric(df_raw["year"], errors="coerce") >= start_year) &
            (pd.to_numeric(df_raw["year"], errors="coerce") <= end_year)
        ]

        for _, row in df_raw.iterrows():
            location = str(row.get("location_name", "")).strip()
            iso3 = _location_to_iso3(location, iso3_cache)
            if not iso3:
                skipped_locations.add(location)
                continue

            cause = str(row.get(cause_col, "All causes")).strip() if cause_col else "All causes"
            measure      = str(row["measure_name"]).strip()
            metric       = str(row["metric_name"]).strip()
            age          = str(row["age_name"]).strip()
            measure_short = KEEP_MEASURES.get(measure, "MEASURE")
            metric_short  = KEEP_METRICS.get(metric, "METRIC")
            age_short     = KEEP_AGES.get(age, "AGE")

            try:
                value = float(row["val"])
                year  = int(row["year"])
            except (TypeError, ValueError):
                continue

            all_records.append({
                "iso3":           iso3,
                "country_name":   get_country_name(iso3),
                "year":           year,
                "indicator_code": _make_indicator_code(measure_short, cause, metric_short, age_short),
                "indicator_name": _make_indicator_name(measure, cause, metric, age),
                "value":          value,
                "source":         "IHME GBD",
                "pulled_at":      pulled_at,
            })

    if not all_records:
        print("  ✗ No records extracted — check file format and column names.")
        return pd.DataFrame()

    if skipped_locations:
        print(f"  ⚠ Skipped {len(skipped_locations)} unrecognised location(s): "
              f"{', '.join(sorted(skipped_locations)[:5])}{'...' if len(skipped_locations) > 5 else ''}")
        print(f"    Add overrides to GBD_NAME_OVERRIDES in ihme_gbd.py if needed.")

    df = make_standard_df(all_records)
    print(f"\n  Total records: {len(df):,}")
    print(f"  Countries:     {df['iso3'].nunique()}")
    print(f"  Indicators:    {df['indicator_code'].nunique()}")

    if save and not df.empty:
        save_data(df, "ihme_gbd", PROCESSED_DIR)

    return df


def _print_download_instructions(directory: str) -> None:
    print(f"\n  ⚠  IHME GBD files not found at:")
    print(f"     {directory}")
    print(f"\n  Please download the data manually:")
    print(f"  1. Go to https://ghdx.healthdata.org/gbd-results")
    print(f"  2. Select filters:")
    print(f"       Measure:  Deaths, DALYs, Incidence, Prevalence")
    print(f"       Metric:   Rate, Number")
    print(f"       Age:      Age-standardized, All ages")
    print(f"       Sex:      Both")
    print(f"       Location: All countries and territories")
    print(f"       Year:     All years")
    print(f"  3. Click 'Download' and extract the ZIP")
    print(f"  4. Copy all CSV files to:")
    print(f"     {directory}")
    print(f"\n  Skipping IHME GBD — all other sources will still run.")
