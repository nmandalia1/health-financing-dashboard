#!/bin/bash
# ══════════════════════════════════════════════════════════
#  Health Financing Dashboard — Data Pipeline Launcher
#  Double-click this file to fetch all data.
#  Results are saved as CSV files you can open in Excel.
# ══════════════════════════════════════════════════════════

# Move to the folder this script lives in
cd "$(dirname "$0")"

echo ""
echo "══════════════════════════════════════════════════════"
echo "   Health Financing Dashboard — Data Pipeline"
echo "══════════════════════════════════════════════════════"
echo ""

# ── Step 1: Install packages ───────────────────────────────
echo "► Step 1/3: Installing required packages..."
echo "  (This only takes long the first time)"
echo ""
python3 -m pip install wbgapi pandas requests pyarrow openpyxl tqdm pycountry plotly 2>&1 | grep -v "already satisfied" | grep -v "Requirement" | grep -v "WARNING" || true
echo ""
echo "  ✓ Packages ready."
echo ""

# ── Step 2: Check packages loaded correctly ────────────────
python3 -c "import wbgapi, pandas, requests, pycountry, tqdm" 2>&1
if [ $? -ne 0 ]; then
    echo ""
    echo "✗ ERROR: Some packages failed to install."
    echo "  Please take a screenshot of this window and share it."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

# ── Step 3: Run the pipeline ───────────────────────────────
echo "► Step 2/3: Fetching data from all sources..."
echo "  World Bank → WHO GHO → IMF → Global Fund"
echo "  (This will take 15–30 minutes — please leave this window open)"
echo ""
python3 run_pipeline.py
echo ""

# ── Step 4: Open the output folder ────────────────────────
echo "► Step 3/3: Opening your data folder in Finder..."
open data/processed
echo ""
echo "══════════════════════════════════════════════════════"
echo "   All done! Your CSV files are now open in Finder."
echo "   You can open any .csv file directly in Excel."
echo "══════════════════════════════════════════════════════"
echo ""
read -p "Press Enter to close this window..."
