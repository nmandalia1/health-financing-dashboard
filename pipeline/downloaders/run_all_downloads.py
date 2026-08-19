"""
run_all_downloads.py — Run all Playwright-based data downloaders.

Usage:
  python -m pipeline.downloaders.run_all_downloads

Environment variables (set before running):
  GHDX_EMAIL      — GHDx account email     (for IHME FGH)
  GHDX_PASSWORD   — GHDx account password  (for IHME FGH)
  OECD_EMAIL      — OECD account email      (for OECD Health Stats)
  OECD_PASSWORD   — OECD account password   (for OECD Health Stats)

Registration links (all free):
  IHME GHDx:  https://ghdx.healthdata.org/user/register
  OECD:       https://www.oecd.org/en/about/myoecd.html

Global Fund bulk data requires no credentials.
"""

import os
import sys
import asyncio
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))


async def run_global_fund():
    from pipeline.downloaders.download_global_fund import download_global_fund
    print("\n" + "="*60)
    print(" GLOBAL FUND BULK DATA  (no login required)")
    print("="*60)
    return await download_global_fund()


async def run_ihme_fgh():
    email    = os.environ.get("GHDX_EMAIL")
    password = os.environ.get("GHDX_PASSWORD")
    if not email or not password:
        print("\n  ⚠  Skipping IHME FGH — GHDX_EMAIL / GHDX_PASSWORD not set.")
        print("     Register free at: https://ghdx.healthdata.org/user/register")
        return False
    from pipeline.downloaders.download_ihme_fgh import download_fgh
    print("\n" + "="*60)
    print(" IHME FINANCING GLOBAL HEALTH  (requires GHDx account)")
    print("="*60)
    return await download_fgh(email, password)


async def run_oecd():
    email    = os.environ.get("OECD_EMAIL")
    password = os.environ.get("OECD_PASSWORD")
    if not email or not password:
        print("\n  ⚠  Skipping OECD — OECD_EMAIL / OECD_PASSWORD not set.")
        print("     Register free at: https://www.oecd.org/en/about/myoecd.html")
        return False
    from pipeline.downloaders.download_oecd import download_oecd_sha
    print("\n" + "="*60)
    print(" OECD HEALTH STATISTICS  (requires OECD account)")
    print("="*60)
    return await download_oecd_sha(email, password)


async def main():
    print("\n" + "="*60)
    print("  BROWSER-BASED DATA DOWNLOADS  —  Playwright")
    print("="*60)

    results = {}

    # Global Fund — no auth needed
    results["global_fund"] = await run_global_fund()

    # IHME FGH — needs GHDx account
    results["ihme_fgh"] = await run_ihme_fgh()

    # OECD — needs OECD account
    results["oecd"] = await run_oecd()

    # Summary
    print("\n" + "="*60)
    print(" DOWNLOAD SUMMARY")
    print("="*60)
    for src, ok in results.items():
        status = "✓" if ok else ("⚠ skipped/failed")
        print(f"  {src:<20} {status}")

    any_downloaded = any(results.values())
    if any_downloaded:
        print("\n  Re-run the main pipeline to incorporate new files:")
        print("  python run_pipeline.py")

    return any_downloaded


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
