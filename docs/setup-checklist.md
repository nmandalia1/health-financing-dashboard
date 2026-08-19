# Setup checklist

Local work is done: single repo on `main`, 2.4MB tracked, pipeline + dashboard +
workflow + publish script all committed. What follows needs your accounts.

## A. GitHub

1. Create an empty repo (no README/licence — this repo already has commits).
2. Push:
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

## B. Cloudflare R2 — DONE

Bucket, public access and CORS were created with wrangler. Live values:

| | |
|---|---|
| Bucket | `health-financing-data` |
| Public URL | `https://pub-1e42425823a040eea615cddd428dc856.r2.dev` |
| S3 endpoint | `https://5b136f9255dec6ad5e1e68868abdbf28.r2.cloudflarestorage.com` |
| CORS | `*` origins, GET/HEAD, range header exposed |

CORS allows all origins deliberately: the bucket is already public, so scoping
origins would not restrict access to the data — it would only break the site if
the deploy domain changed. Re-apply with `wrangler r2 bucket cors set
health-financing-data --file docs/r2-cors.json` if you ever narrow it.

Still yours to do: **R2 → Manage API tokens → Create token**, Object Read &
Write scoped to this bucket. The Access Key ID and Secret Access Key are shown
once. There is no wrangler command for this.

## C. GitHub secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Name | Value |
|---|---|
| `R2_BUCKET` | bucket name from A.1 |
| `R2_ENDPOINT` | S3 endpoint from B.5 |
| `R2_ACCESS_KEY_ID` | from B.4 |
| `R2_SECRET_ACCESS_KEY` | from B.4 |

Enter these yourself in the GitHub UI. Do not paste them into chat.

## D. First publish

Actions → "Refresh dashboard data" → Run workflow. Takes a while: it runs the
full pipeline against the WHO/World Bank/IMF APIs before uploading.

Then confirm in a browser that this returns a file, not an error:
`https://<public-bucket-url>/master.parquet`

## E. Vercel

1. Import the GitHub repo.
2. **Root Directory: `dashboard`** — the default (repo root) will fail.
3. Environment variable:
   ```
   NEXT_PUBLIC_DATA_BASE_URL = https://<public-bucket-url>
   ```
4. Deploy, then go back to B.3 and put the real Vercel domain in the CORS policy.

## F. Verify

Open a country page on the deployed site. If the KPI figures populate, the
browser reached R2 cross-origin and the whole chain works.

If they never populate, it is almost always one of:
- `NEXT_PUBLIC_DATA_BASE_URL` unset, or has a trailing path that is not the bucket root
- CORS not listing the exact Vercel origin (scheme + host, no trailing slash)
- Bucket not public

## Optional: drop the jsDelivr dependency

The DuckDB WASM runtime loads from a third-party CDN by default; if it is blocked,
the dashboard hangs with no error. To serve it yourself:

```bash
brew install awscli            # only needed for publishing from your machine
export R2_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
./dashboard/scripts/publish-data.sh --with-runtime
```

then add to Vercel:
```
NEXT_PUBLIC_DUCKDB_BASE_URL = https://<public-bucket-url>/duckdb
```
