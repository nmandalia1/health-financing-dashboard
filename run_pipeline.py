"""
run_pipeline.py — Main orchestrator for the Health Financing Dashboard data pipeline.

Usage:
    python run_pipeline.py

Or open Health_Dashboard_Pipeline.ipynb in Jupyter.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pipeline.config import LOGS_DIR, PROCESSED_DIR
from pipeline.utils import configure_logging, load_all_sources, load_skip_log, save_data

logger = logging.getLogger(__name__)

# ── Sources that can run in parallel (all fetch from independent APIs) ──────
PARALLEL_SOURCES = ["world_bank", "who_gho", "imf", "who_immunization", "wuenic", "wgi"]
# ── Sources that must run after country_metadata is ready ──────────────────
SEQUENTIAL_SOURCES = [
    "global_fund", "ghed", "ihme_gbd", "ihme_fgh", "oecd_health", "unaids", "pefa",
]


def _run_source(name: str, start_year: int, end_year: int) -> pd.DataFrame:
    """
    Dispatch to the appropriate fetch function for a named source.
    Raises on failure — callers catch and record to failures dict.
    """
    if name == "country_metadata":
        from pipeline.country_metadata import fetch_country_metadata
        return fetch_country_metadata(save=True)

    if name == "world_bank":
        from pipeline.world_bank import fetch_world_bank
        return fetch_world_bank(start_year=start_year, end_year=end_year, save=True)

    if name == "who_gho":
        from pipeline.who_gho import fetch_who_gho
        return fetch_who_gho(start_year=start_year, end_year=end_year, save=True)

    if name == "imf":
        from pipeline.config import IMF_PROJECTION_END_YEAR
        from pipeline.imf import fetch_imf
        return fetch_imf(
            start_year=start_year, end_year=end_year,
            projection_end_year=IMF_PROJECTION_END_YEAR, save=True,
        )

    if name == "who_immunization":
        from pipeline.who_immunization import fetch_who_immunization
        return fetch_who_immunization(start_year=start_year, end_year=end_year, save=True)

    if name == "wuenic":
        from pipeline.wuenic import fetch_wuenic
        return fetch_wuenic(start_year=start_year, end_year=end_year, save=True)

    if name == "global_fund":
        from pipeline.global_fund import fetch_global_fund
        return fetch_global_fund(save=True)

    if name == "ghed":
        from pipeline.ghed import process_ghed
        return process_ghed(start_year=start_year, end_year=end_year, save=True)

    if name == "ihme_gbd":
        from pipeline.ihme_gbd import process_ihme_gbd
        return process_ihme_gbd(start_year=start_year, end_year=end_year, save=True)

    if name == "ihme_fgh":
        from pipeline.ihme_fgh import process_ihme_fgh
        return process_ihme_fgh(start_year=start_year, end_year=end_year, save=True)

    if name == "oecd_health":
        from pipeline.oecd_health import process_oecd_health
        return process_oecd_health(start_year=start_year, end_year=end_year, save=True)

    if name == "unaids":
        from pipeline.unaids import process_unaids
        return process_unaids(start_year=start_year, end_year=end_year, save=True,
                              auto_download=True)

    if name == "wgi":
        from pipeline.wgi import fetch_wgi
        return fetch_wgi(start_year=start_year, end_year=end_year, save=True)

    if name == "pefa":
        from pipeline.pefa import process_pefa
        return process_pefa(start_year=start_year, end_year=end_year, save=True,
                            auto_download=True)

    raise ValueError(f"Unknown source: {name!r}")


def _write_manifest(
    run_started_at: str,
    elapsed_seconds: float,
    results: dict[str, int],
    failures: dict[str, str],
    master_rows: int,
    master_countries: int,
    master_indicators: int,
) -> None:
    """
    Write a JSON manifest recording the outcome of this pipeline run.
    Saved to logs/pipeline_manifest.json — overwrites each run.
    """
    Path(LOGS_DIR).mkdir(parents=True, exist_ok=True)
    manifest = {
        "run_started_at":  run_started_at,
        "run_finished_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "elapsed_seconds": round(elapsed_seconds, 1),
        "sources": {
            src: {"rows": rows, "status": "ok" if rows > 0 else "empty"}
            for src, rows in results.items()
        },
        "failures": failures,
        "master": {
            "rows":       master_rows,
            "countries":  master_countries,
            "indicators": master_indicators,
        },
    }
    path = Path(LOGS_DIR) / "pipeline_manifest.json"
    path.write_text(json.dumps(manifest, indent=2))
    logger.info("Pipeline manifest written to %s", path)


def run_all(
    sources: list[str] | None = None,
    start_year: int = 2000,
    end_year: int = 2024,
) -> pd.DataFrame:
    """
    Run the full data pipeline, fetching all configured sources.

    World Bank, WHO GHO, and IMF are fetched in parallel.
    Other sources run sequentially after country metadata is ready.

    Args:
        sources:    List of source names to run. Defaults to all sources.
        start_year: First year to fetch data for.
        end_year:   Last year to fetch data for.

    Returns:
        Master DataFrame combining all sources.
    """
    all_sources = ["country_metadata"] + PARALLEL_SOURCES + SEQUENTIAL_SOURCES
    if sources is None:
        sources = all_sources

    run_started_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    t_start        = time.time()

    logger.info("=" * 60)
    logger.info("HEALTH FINANCING DASHBOARD — DATA PIPELINE")
    logger.info("Started:  %s", run_started_at)
    logger.info("Sources:  %s", ", ".join(sources))
    logger.info("Years:    %d – %d", start_year, end_year)
    logger.info("=" * 60)

    results:  dict[str, int] = {}
    failures: dict[str, str] = {}

    # ── 1. Country metadata first (other sources may depend on it) ──────────
    if "country_metadata" in sources:
        try:
            df = _run_source("country_metadata", start_year, end_year)
            results["country_metadata"] = len(df)
        except Exception as exc:
            failures["country_metadata"] = str(exc)
            logger.error("country_metadata failed: %s", exc)

    # ── 2. Parallel: World Bank, WHO GHO, IMF ───────────────────────────────
    parallel = [s for s in PARALLEL_SOURCES if s in sources]
    if parallel:
        logger.info("Running %d sources in parallel: %s", len(parallel), parallel)
        with ThreadPoolExecutor(max_workers=len(parallel)) as pool:
            futures = {
                pool.submit(_run_source, name, start_year, end_year): name
                for name in parallel
            }
            for future in as_completed(futures):
                name = futures[future]
                try:
                    df = future.result()
                    results[name] = len(df) if df is not None else 0
                    logger.info("%s complete: %d rows", name, results[name])
                except Exception as exc:
                    failures[name] = str(exc)
                    logger.error("%s failed: %s", name, exc)

    # ── 3. Sequential: manual-download sources ──────────────────────────────
    for name in SEQUENTIAL_SOURCES:
        if name not in sources:
            continue
        try:
            df = _run_source(name, start_year, end_year)
            results[name] = len(df) if df is not None else 0
            logger.info("%s complete: %d rows", name, results[name])
        except Exception as exc:
            failures[name] = str(exc)
            logger.error("%s failed: %s", name, exc)

    # ── 4. Build master dataset ──────────────────────────────────────────────
    logger.info("Building master dataset…")
    # Exclude mart_*.parquet files (reference schema, not long-format)
    master = load_all_sources(PROCESSED_DIR)

    if not master.empty:
        # Guard: drop any rows with malformed iso3 codes (e.g. "SDN736" from WHO GHO)
        bad_iso3_mask = master["iso3"].astype(str).str.len() != 3
        if bad_iso3_mask.any():
            bad_codes = master.loc[bad_iso3_mask, "iso3"].unique().tolist()
            logger.warning(
                "Dropping %d rows with non-3-char iso3 codes: %s",
                bad_iso3_mask.sum(), bad_codes,
            )
            master = master[~bad_iso3_mask].reset_index(drop=True)

        save_data(master, "master", PROCESSED_DIR)
        logger.info(
            "Master dataset: %d rows | %d countries | %d indicators | %d sources",
            len(master), master["iso3"].nunique(),
            master["indicator_code"].nunique(), master["source"].nunique(),
        )

        # ── 4b. Build the source-faithful research package ──────────────────
        # This is the primary analysis interface for Positron. It preserves
        # all source rows in an audit layer and creates separate financing,
        # program, context, and PFM convenience files without imputation.
        try:
            from pipeline.research_data import build_research_package
            build_research_package()
        except Exception as exc:
            logger.warning("Research package build failed: %s", exc)

        # ── 4c. Build analytical marts (PFM × health joins) ────────────────
        try:
            from pipeline.analytical_marts import build_all as build_marts
            build_marts(save=True)
        except Exception as exc:
            logger.warning("Analytical mart build failed: %s", exc)

        # ── 4d. Generate the fiscal-space data-readiness report ────────────
        # Audits registry coverage against the freshly-built master so pull
        # gaps and registry↔data drift surface on every run (logs/data_readiness.md).
        try:
            from pipeline.data_readiness import build_readiness_report
            build_readiness_report()
            logger.info("Wrote data-readiness report → logs/data_readiness.md")
        except Exception as exc:
            logger.warning("Data-readiness report failed: %s", exc)
    else:
        logger.warning("No data available to build master dataset.")

    # ── 5. Write run manifest ────────────────────────────────────────────────
    elapsed = time.time() - t_start
    _write_manifest(
        run_started_at  = run_started_at,
        elapsed_seconds = elapsed,
        results         = results,
        failures        = failures,
        master_rows     = len(master),
        master_countries  = int(master["iso3"].nunique()) if not master.empty else 0,
        master_indicators = int(master["indicator_code"].nunique()) if not master.empty else 0,
    )

    # ── 6. Summary ───────────────────────────────────────────────────────────
    mins, secs = divmod(int(elapsed), 60)
    logger.info("=" * 60)
    logger.info("PIPELINE COMPLETE — %dm %ds", mins, secs)

    if results:
        logger.info("Successful sources:")
        for src, n in results.items():
            logger.info("  ✓ %-20s %8d rows", src, n)

    if failures:
        logger.warning("Failed sources (%d):", len(failures))
        for src, err in failures.items():
            logger.warning("  ✗ %s: %s", src, err)

    skip_log = load_skip_log()
    if not skip_log.empty:
        logger.info("Skipped indicators: %d total", len(skip_log))
        for reason, count in skip_log.groupby("reason").size().items():
            logger.info("  • %-15s %3d indicator(s)", reason, count)

    return master


def print_summary(df: pd.DataFrame) -> None:
    """Print a summary of a loaded master DataFrame."""
    if df is None or df.empty:
        print("No data loaded.")
        return

    print(f"\n{'='*60}")
    print(" MASTER DATASET SUMMARY")
    print(f"{'='*60}")
    print(f"  Total rows:   {len(df):,}")
    print(f"  Countries:    {df['iso3'].nunique()}")
    print(f"  Indicators:   {df['indicator_code'].nunique()}")
    print(f"  Year range:   {df['year'].min()} – {df['year'].max()}")
    print(f"  Sources:")
    for src in df["source"].unique():
        sub = df[df["source"] == src]
        print(f"    • {str(src):<20} {len(sub):>8,} rows | "
              f"{sub['indicator_code'].nunique():>3} indicators | "
              f"{sub['iso3'].nunique():>3} countries")
    print()


if __name__ == "__main__":
    configure_logging()
    master = run_all()
    print_summary(master)
