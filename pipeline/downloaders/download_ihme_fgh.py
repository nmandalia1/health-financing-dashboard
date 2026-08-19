"""
download_ihme_fgh.py — Download IHME Financing Global Health (FGH) data via Playwright.

Source:  Institute for Health Metrics and Evaluation (IHME)
Dataset: Financing Global Health 2021 (1995–2021)
URL:     https://ghdx.healthdata.org/record/ihme-data/gbd-2021-financing-global-health-1995-2021

Requires a free GHDx account:
  Register at https://ghdx.healthdata.org/user/register

Set credentials via environment variables before running:
  export GHDX_EMAIL="your@email.com"
  export GHDX_PASSWORD="yourpassword"

Or pass them as CLI args:
  python download_ihme_fgh.py --email your@email.com --password yourpassword
"""

import os
import sys
import asyncio
import argparse
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

RECORD_URL   = "https://ghdx.healthdata.org/record/ihme-data/gbd-2021-financing-global-health-1995-2021"
LOGIN_URL    = "https://ghdx.healthdata.org/user/login"
DOWNLOAD_DIR = PROJECT_ROOT / "data" / "manual_downloads" / "ihme_fgh"


async def login(page, email: str, password: str) -> bool:
    """Log in to GHDx. Returns True on success."""
    print("  Navigating to GHDx login...")
    await page.goto(LOGIN_URL, timeout=30_000)
    await page.wait_for_load_state("networkidle", timeout=15_000)

    # Fill login form
    await page.fill('input[name="name"], input#edit-name', email)
    await page.fill('input[name="pass"], input#edit-pass', password)
    await page.click('input[value="Log in"], button[type="submit"]')
    await page.wait_for_load_state("networkidle", timeout=15_000)

    # Confirm login succeeded
    current = page.url
    if "user/login" in current or "login" in current:
        text = await page.inner_text("body")
        if "incorrect" in text.lower() or "unrecognized" in text.lower():
            print("  ✗ Login failed — check credentials.")
            return False

    print("  ✓ Logged in.")
    return True


async def download_fgh(email: str, password: str) -> bool:
    """
    Navigate to the FGH record, find download links, and save all CSV/zip files.
    Returns True if at least one file was downloaded.
    """
    from playwright.async_api import async_playwright

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            accept_downloads=True,
        )
        page = await ctx.new_page()

        # ── Login ─────────────────────────────────────────────
        ok = await login(page, email, password)
        if not ok:
            await browser.close()
            return False

        # ── Navigate to FGH record ─────────────────────────────
        print(f"\n  Navigating to FGH record...")
        await page.goto(RECORD_URL, timeout=30_000)
        await page.wait_for_load_state("networkidle", timeout=20_000)
        await page.wait_for_timeout(3000)

        # ── Find file download links ───────────────────────────
        # GHDx record pages have file links in the "Files" section or "Get data files" links
        links = await page.eval_on_selector_all(
            "a",
            "els => els.map(e => ({href: e.href, text: e.textContent.trim()}))"
        )

        # Filter to data file links
        data_links = [
            l for l in links
            if any(ext in l["href"].lower() for ext in [".csv", ".zip", ".xlsx"])
            or "download" in l["href"].lower()
            or "files" in l["href"].lower()
        ]

        # Also look for "Get data files" cloud link
        cloud_links = [
            l for l in links
            if any(x in l["text"].lower() for x in ["get data", "data files", "cloud"])
        ]

        print(f"  Found {len(data_links)} file links, {len(cloud_links)} cloud links")
        for l in (data_links + cloud_links)[:10]:
            print(f"    {l['text'][:50]:50} -> {l['href'][:80]}")

        # ── Download files ────────────────────────────────────
        if not data_links and not cloud_links:
            # Try clicking a "Files" or "Downloads" tab
            for tab_text in ["Files", "Download", "Get data files"]:
                tab = await page.query_selector(f'text={tab_text}')
                if tab:
                    await tab.click()
                    await page.wait_for_timeout(2000)
                    links = await page.eval_on_selector_all(
                        "a",
                        "els => els.map(e => ({href: e.href, text: e.textContent.trim()}))"
                    )
                    data_links = [
                        l for l in links
                        if any(ext in l["href"].lower() for ext in [".csv", ".zip", ".xlsx"])
                    ]
                    if data_links:
                        print(f"  Found {len(data_links)} files after clicking '{tab_text}' tab")
                    break

        for link in data_links:
            href = link["href"]
            fname = href.split("/")[-1].split("?")[0] or "fgh_data.zip"
            dest = DOWNLOAD_DIR / fname

            if dest.exists():
                print(f"  ↩ Already exists: {fname}")
                downloaded.append(fname)
                continue

            print(f"  ↓ Downloading: {fname}...")
            try:
                async with page.expect_download(timeout=120_000) as dl_info:
                    await page.goto(href, timeout=30_000)
                dl = await dl_info.value
                await dl.save_as(dest)
                size_mb = dest.stat().st_size / 1_048_576
                print(f"  ✓ Saved: {fname} ({size_mb:.1f} MB)")
                downloaded.append(fname)
            except Exception as e:
                print(f"  ✗ Download failed for {href}: {e}")

        await browser.close()

    if downloaded:
        print(f"\n  ✓ Downloaded {len(downloaded)} file(s) to {DOWNLOAD_DIR}")
        return True
    else:
        print("\n  ✗ No files downloaded — record may require additional access.")
        return False


def main():
    parser = argparse.ArgumentParser(description="Download IHME FGH data from GHDx")
    parser.add_argument("--email",    default=os.environ.get("GHDX_EMAIL"),    help="GHDx email")
    parser.add_argument("--password", default=os.environ.get("GHDX_PASSWORD"), help="GHDx password")
    args = parser.parse_args()

    if not args.email or not args.password:
        print("Error: GHDx credentials required.")
        print("  Set GHDX_EMAIL and GHDX_PASSWORD environment variables, or pass --email/--password.")
        print("  Register (free) at: https://ghdx.healthdata.org/user/register")
        sys.exit(1)

    print("\n" + "="*60)
    print(" IHME FGH DOWNLOAD  —  Playwright")
    print("="*60)

    ok = asyncio.run(download_fgh(args.email, args.password))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
