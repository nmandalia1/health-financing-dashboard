#!/bin/bash
# Copies pipeline parquet outputs to the dashboard public directory
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$DASHBOARD_DIR")"
SOURCE_DIR="$PROJECT_ROOT/data/processed"
DEST_DIR="$DASHBOARD_DIR/public/data"

mkdir -p "$DEST_DIR"

REQUIRED_FILES="master.parquet country_metadata.parquet"
OPTIONAL_FILES="mart_pefa_health.parquet mart_pefa_events.parquet mart_fiscal_space.parquet mart_fiscal_components.parquet pefa.parquet wgi.parquet"

for file in $REQUIRED_FILES; do
  if [ ! -f "$SOURCE_DIR/$file" ]; then
    echo "ERROR: $SOURCE_DIR/$file not found. Run the pipeline first."
    exit 1
  fi
  cp "$SOURCE_DIR/$file" "$DEST_DIR/$file"
  size=$(du -h "$DEST_DIR/$file" | cut -f1)
  echo "Copied $file ($size)"
done

for file in $OPTIONAL_FILES; do
  if [ -f "$SOURCE_DIR/$file" ]; then
    cp "$SOURCE_DIR/$file" "$DEST_DIR/$file"
    size=$(du -h "$DEST_DIR/$file" | cut -f1)
    echo "Copied $file ($size)"
  else
    echo "Skipped $file (not present — run the PEFA pipeline to enable PFM dashboard)"
  fi
done

echo "Done. Data files ready in $DEST_DIR"
