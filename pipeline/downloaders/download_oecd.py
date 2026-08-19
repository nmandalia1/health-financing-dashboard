"""
download_oecd.py — Download OECD Health Statistics via Playwright.

Source:  OECD Health Statistics (System of Health Accounts)
Dataset: SHA — health expenditure by financing scheme, provider, function
URL:     https://data-explorer.oecd.org/

The OECD Data Explorer requires a free OECD account to download data:
  Register at https://www.oecd.org/en/about/myoecd.html

Set credentials via environment variables:
  export OECD_EMAIL="your@email.com"
  export OECD_PASSWORD="yourpassword"

What is downloaded:
  - System of Health Accounts (SHA): current health expenditure by
    financing scheme, provider, function — all OECD + partner countries
  Saved to: data/manual_downloads/oecd_health/
"""

import os
import sys
import asyncio
import argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

DOWNLOAD_DIR = PROJECT_ROOT / "data" / "manual_downloads" / "oecd_health"

# SHA dataset on OECD Data Explorer (System of Health Accounts)
SHA_VIS_URL = (
    "https://data-explorer.oecd.org/vis"
    "?lc=en&pg=0&snb=26"
    "&df[ds]=dsDisseminateFinalDMZ"
    "&df[id]=DSD_SHA%40DF_SHA"
    "&df[ag]=OECD.WISE.HAI"
    "&df[vs]=1.0"
)

LOGIN_URL = "https://signin.oecd.org/adfs/ls/?client-request-id=&pullStatus=0"


async def login_oecd(page, email: str, password: str) -> bool:
    """
    Log in to OECD account via the ADFS SSO.
    Returns True on success.
    """
    print("  Navigating to OECD login...")

    # The Data Explorer redirects to signin.oecd.org — trigger it by visiting the viz
    await page.goto(SHA_VIS_URL, timeout=30_000)
    await page.wait_for_load_state("networkidle", timeout=15_000)

    # Click "Sign in" if present on the page
    try:
        sign_in = await page.query_selector('text=Sign in, text=Log in, [href*="signin"], [href*="login"]')
        if sign_in:
            await sign_in.click()
            await page.wait_for_load_state("networkidle", timeout=10_000)
    except Exception:
        pass

    # If we're on the OECD ADFS login page, fill in credentials
    current_url = page.url
    if "signin.oecd.org" in current_url or "adfs" in current_url:
        await page.fill('input[name="userNameInput"], input[type="email"], #userNameInput', email)
        await page.click('input[id="nextButton"], button[type="submit"], input[type="submit"]')
        await page.wait_for_timeout(1500)

        try:
            await page.fill('input[name="passwordInput"], input[type="password"], #passwordInput', password)
            await page.click('input[id="submitButton"], button[type="submit"]')
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception as e:
            print(f"  ✗ Password step failed: {e}")
            return False

    # Check if we made it back to data-explorer
    await page.wait_for_timeout(3000)
    current_url = page.url
    if "data-explorer.oecd.org" in current_url:
        print("  ✓ Logged in to OECD.")
        return True

    print(f"  ✗ Login may have failed. Current URL: {current_url}")
    return False


async def download_oecd_sha(email: str, password: str) -> bool:
    """
    Log in to OECD, navigate to the SHA dataset, and download as CSV.
    Returns True if file downloaded successfully.
    """
    from playwright.async_api import async_playwright

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1920, "height": 1080},
            accept_downloads=True,
        )
        page = await ctx.new_page()

        # ── Login ─────────────────────────────────────────────
        ok = await login_oecd(page, email, password)
        if not ok:
            await browser.close()
            return False

        # ── Navigate to SHA viz ────────────────────────────────
        print("  Navigating to SHA dataset...")
        await page.goto(SHA_VIS_URL, timeout=30_000)
        await page.wait_for_load_state("networkidle", timeout=20_000)
        await page.wait_for_timeout(6000)

        # Confirm data loaded (should no longer say "no data available")
        text = await page.inner_text("body")
        if "no data available" in text.lower():
            print("  ✗ Data still not available — login may not have worked.")
            await browser.close()
            return False

        # ── Find download button ───────────────────────────────
        # OECD Data Explorer has a toolbar with a download icon (cloud/arrow)
        download_selectors = [
            '[title*="Download"]',
            '[aria-label*="Download"]',
            '[title*="download"]',
            'button[class*="download"]',
            '.oecd-download',
            '[data-testid="download"]',
        ]

        download_btn = None
        for sel in download_selectors:
            el = await page.query_selector(sel)
            if el:
                download_btn = el
                print(f"  Found download button: {sel}")
                break

        if not download_btn:
            # Try finding via icon text or SVG title
            btns = await page.query_selector_all("button, [role='button']")
            for btn in btns:
                title = await btn.get_attribute("title") or ""
                label = await btn.get_attribute("aria-label") or ""
                if "download" in (title + label).lower():
                    download_btn = btn
                    print(f"  Found download button via title/label")
                    break

        if not download_btn:
            print("  ✗ Could not find download button.")
            await page.screenshot(path=str(DOWNLOAD_DIR / "oecd_debug.png"))
            print(f"    Screenshot saved to {DOWNLOAD_DIR}/oecd_debug.png")
            await browser.close()
            return False

        # ── Click download and select CSV ─────────────────────
        dest = DOWNLOAD_DIR / "oecd_health_sha.csv"
        if dest.exists():
            print(f"  ↩ Already exists: {dest.name}")
            await browser.close()
            return True

        print("  Clicking download button...")
        await download_btn.click()
        await page.wait_for_timeout(1500)

        # Look for "Filtered data in tabular text (CSV)" option
        csv_option = await page.query_selector(
            'text=Filtered data in tabular text, text=CSV, [title*="CSV"], [aria-label*="CSV"]'
        )
        if csv_option:
            print("  Selecting CSV format...")
            try:
                async with page.expect_download(timeout=120_000) as dl_info:
                    await csv_option.click()
                dl = await dl_info.value
                await dl.save_as(dest)
                size_mb = dest.stat().st_size / 1_048_576
                print(f"  ✓ Saved: {dest.name} ({size_mb:.1f} MB)")
                await browser.close()
                return True
            except Exception as e:
                print(f"  ✗ CSV download failed: {e}")
        else:
            # Try direct download if no dropdown appeared
            try:
                async with page.expect_download(timeout=120_000) as dl_info:
                    await download_btn.click()
                dl = await dl_info.value
                fname = dl.suggested_filename or "oecd_health_sha.csv"
                dest = DOWNLOAD_DIR / fname
                await dl.save_as(dest)
                size_mb = dest.stat().st_size / 1_048_576
                print(f"  ✓ Saved: {fname} ({size_mb:.1f} MB)")
                await browser.close()
                return True
            except Exception as e:
                print(f"  ✗ Download failed: {e}")

        await browser.close()
        return False


def main():
    parser = argparse.ArgumentParser(description="Download OECD Health Statistics (SHA)")
    parser.add_argument("--email",    default=os.environ.get("OECD_EMAIL"),    help="OECD account email")
    parser.add_argument("--password", default=os.environ.get("OECD_PASSWORD"), help="OECD account password")
    args = parser.parse_args()

    if not args.email or not args.password:
        print("Error: OECD credentials required.")
        print("  Set OECD_EMAIL and OECD_PASSWORD environment variables, or pass --email/--password.")
        print("  Register (free) at: https://www.oecd.org/en/about/myoecd.html")
        sys.exit(1)

    print("\n" + "="*60)
    print(" OECD HEALTH STATISTICS DOWNLOAD  —  Playwright")
    print("="*60)

    ok = asyncio.run(download_oecd_sha(args.email, args.password))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
