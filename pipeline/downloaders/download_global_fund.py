"""
download_global_fund.py — Download Global Fund bulk data files.

Source:  The Global Fund to Fight AIDS, Tuberculosis and Malaria
URL:     https://data-service.theglobalfund.org/downloads

What is downloaded (no login required):
  - Pledges & Contributions Excel (donor contributions by year)
  - COVID-19 Response Funding Excel

Discovery: The downloads page is a Blazor Server app. Clicking the EXCEL button
opens a MudMenu dropdown with "Download" and "Copy link" options. "Copy link"
reveals the direct download URLs on data-service.theglobalfund.org/file_download/...
These URLs are accessible without authentication or a browser session.

Saved to: data/manual_downloads/global_fund_bulk/
"""

import sys
import requests
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

DOWNLOADS_URL = "https://data-service.theglobalfund.org/downloads"
DOWNLOAD_DIR  = PROJECT_ROOT / "data" / "manual_downloads" / "global_fund_bulk"

# Direct download URLs — discovered by inspecting the MudMenu "Copy link" clipboard output.
# Pattern: https://data-service.theglobalfund.org/file_download/{slug}/EXCELOPENXML
DATASETS = [
    {
        "slug":     "pledges_contributions_report",
        "filename": "pledges_contributions.xlsx",
        "label":    "Pledges and Contributions",
    },
    {
        "slug":     "covid_approved_funding_report",
        "filename": "covid_approved_funding.xlsx",
        "label":    "Funding Approved for COVID-19 Response",
    },
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


def download_global_fund() -> bool:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = []

    for ds in DATASETS:
        url  = f"https://data-service.theglobalfund.org/file_download/{ds['slug']}/EXCELOPENXML"
        dest = DOWNLOAD_DIR / ds["filename"]

        if dest.exists():
            print(f"  ↩ Already exists: {ds['filename']} ({dest.stat().st_size / 1024:.1f} KB)")
            downloaded.append(str(dest))
            continue

        print(f"  ↓ Downloading: {ds['label']}...")
        try:
            r = requests.get(url, headers=HEADERS, timeout=60, stream=True)
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    f.write(chunk)
            size_kb = dest.stat().st_size / 1024
            print(f"  ✓ Saved: {ds['filename']} ({size_kb:.1f} KB)")
            downloaded.append(str(dest))
        except Exception as e:
            print(f"  ✗ Failed: {ds['label']}: {e}")

    if downloaded:
        print(f"\n  ✓ {len(downloaded)} file(s) saved to {DOWNLOAD_DIR}")
        return True
    else:
        print(f"\n  ✗ No files downloaded.")
        return False


def main():
    print("\n" + "=" * 60)
    print(" GLOBAL FUND BULK DOWNLOAD")
    print("=" * 60)
    ok = download_global_fund()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
