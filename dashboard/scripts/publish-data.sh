#!/bin/bash
# Publishes pipeline outputs to an S3-compatible bucket (Cloudflare R2).
#
# This is the deploy step for DATA. Because the dashboard reads Parquet over
# HTTP at runtime, refreshing the figures is an upload — the site itself does
# not need rebuilding or redeploying, and the 21MB master.parquet never has to
# enter git history.
#
#   ./scripts/publish-data.sh                 # data only
#   ./scripts/publish-data.sh --with-runtime  # data + the DuckDB WASM bundles
#
# Required environment:
#   R2_BUCKET             e.g. health-financing-data
#   R2_ENDPOINT           e.g. https://<account-id>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID     R2 access key
#   AWS_SECRET_ACCESS_KEY R2 secret key
#
# The bucket must allow public GET and cross-origin reads from the site origin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$DASHBOARD_DIR")"
SOURCE_DIR="$PROJECT_ROOT/data/processed"
RUNTIME_DIR="$DASHBOARD_DIR/node_modules/@duckdb/duckdb-wasm/dist"

WITH_RUNTIME=0
[ "${1:-}" = "--with-runtime" ] && WITH_RUNTIME=1

for var in R2_BUCKET R2_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set. See the header of this script." >&2
    exit 1
  fi
done

s3() { aws s3 "$@" --endpoint-url "$R2_ENDPOINT"; }

REQUIRED_FILES="master.parquet country_metadata.parquet"
OPTIONAL_FILES="mart_pefa_health.parquet mart_pefa_events.parquet mart_fiscal_space.parquet mart_fiscal_components.parquet pefa.parquet wgi.parquet"

for file in $REQUIRED_FILES; do
  if [ ! -f "$SOURCE_DIR/$file" ]; then
    echo "ERROR: $SOURCE_DIR/$file not found. Run the pipeline first." >&2
    exit 1
  fi
done

echo "Publishing data to s3://$R2_BUCKET"
for file in $REQUIRED_FILES $OPTIONAL_FILES; do
  [ -f "$SOURCE_DIR/$file" ] || { echo "  skip    $file (not present)"; continue; }
  # Short max-age so a refresh is picked up promptly; must-revalidate keeps
  # browsers from serving a stale panel after an update.
  s3 cp "$SOURCE_DIR/$file" "s3://$R2_BUCKET/$file" \
    --content-type application/octet-stream \
    --cache-control "public, max-age=300, must-revalidate" \
    --only-show-errors
  echo "  pushed  $file ($(du -h "$SOURCE_DIR/$file" | cut -f1))"
done

if [ "$WITH_RUNTIME" = "1" ]; then
  echo "Publishing DuckDB runtime to s3://$R2_BUCKET/duckdb"
  if [ ! -d "$RUNTIME_DIR" ]; then
    echo "ERROR: $RUNTIME_DIR not found. Run npm install in dashboard/ first." >&2
    exit 1
  fi
  # Only the two bundles the loader references. The coi (threaded) build needs
  # COOP/COEP headers the site does not set, so shipping it would be dead weight.
  for file in duckdb-mvp.wasm duckdb-browser-mvp.worker.js duckdb-eh.wasm duckdb-browser-eh.worker.js; do
    case "$file" in
      *.wasm) ctype="application/wasm" ;;
      *)      ctype="text/javascript" ;;
    esac
    # Immutable: these change only when the dependency is upgraded, and the
    # filenames are version-stable, so a long TTL is safe and worth it at ~35MB.
    s3 cp "$RUNTIME_DIR/$file" "s3://$R2_BUCKET/duckdb/$file" \
      --content-type "$ctype" \
      --cache-control "public, max-age=31536000, immutable" \
      --only-show-errors
    echo "  pushed  duckdb/$file ($(du -h "$RUNTIME_DIR/$file" | cut -f1))"
  done
fi

echo "Done."
