# Deployment and data refresh

## What this app actually is

There is **no server-side code**: no API routes, no middleware, no server-side data
fetching. Every page is a client component, and all querying happens in the browser
via DuckDB-WASM reading Parquet over HTTP. Next is only producing HTML shells.

That splits hosting into two independent problems:

| | What it serves | Where |
|---|---|---|
| **App** | ~6.5MB of static assets (4.4MB of it Plotly), uncompressed | Vercel |
| **Data** | ~21MB of Parquet, per cold visitor | Cloudflare R2 |

Keeping them apart is what makes a data refresh cheap: it becomes an upload, with no
rebuild, no redeploy, and no 21MB binaries accumulating in git history.

## Hosting: Vercel for the app

Connect the repo, set the root directory to `dashboard/`, and deploy. No configuration
beyond the environment variables below.

Vercel rather than Cloudflare Pages, despite the data living on Cloudflare. Ten route
patterns are `ƒ` (server-rendered on demand) because the `[iso3]` segments have no
`generateStaticParams`. Vercel runs those natively; Cloudflare Pages does not run a Next
server and would need either the `@cloudflare/next-on-pages` adapter with `runtime =
"edge"` on every page, or a full static export. Neither is hard, but both are work for no
gain — and once the 21MB of data is on R2, the app host is only serving a couple of MB
compressed, so its bandwidth allowance stops being the deciding factor.

Two things to check before committing to it: Vercel's Hobby tier forbids commercial use,
so a published institutional dashboard may need Pro; and the free-tier limits quoted
anywhere (including here) go stale, so confirm current numbers.

**If you would rather keep everything on Cloudflare**, the route is a static export:
add `generateStaticParams` to the `[iso3]` and `[pillar]`/`[disease]` segments (~4,100
shells, all trivial), set `output: "export"`, and move the four redirects out of
`next.config.ts` into a `_redirects` file, since `redirects()` is not supported under
static export.

## Data: Cloudflare R2

R2 because egress is free. At ~21MB per cold visitor this is the dominant cost — a
thousand visits is over 20GB — and on a metered host that becomes a real bill.

Create a bucket, enable public read, and allow cross-origin GET from the site origin.
Then point the app at it:

```
NEXT_PUBLIC_DATA_BASE_URL=https://<your-public-bucket-url>
```

Unset, the app reads from its own `/data`, so local development and a self-contained
deploy both work with no configuration.

### Optionally serve the DuckDB runtime yourself

By default the WASM runtime is fetched from **jsDelivr**. That is a third-party CDN
dependency at runtime: if jsDelivr is unreachable the dashboard hangs on a loading
spinner with no error. Corporate and government networks routinely block public CDNs,
which is a meaningful share of this audience.

```bash
./dashboard/scripts/publish-data.sh --with-runtime
```

then set:

```
NEXT_PUBLIC_DUCKDB_BASE_URL=https://<your-public-bucket-url>/duckdb
```

The bundles are 34–39MB each uncompressed, which is why they belong in the bucket rather
than the app deploy — Cloudflare Pages rejects individual files above ~25MiB, and they
change only when the dependency is upgraded.

## Refreshing the data

Automatic: `.github/workflows/refresh-data.yml` runs on the 1st of each month and on
manual trigger. It runs the pipeline and uploads to R2. **The site is not redeployed** —
visitors pick up new figures within the 5-minute cache window.

Required repository secrets:

| Secret | Example |
|---|---|
| `R2_BUCKET` | `health-financing-data` |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |

Manually, from the project root:

```bash
python run_pipeline.py
./dashboard/scripts/publish-data.sh
```

## Cold-load payload

21.4MB over 6 requests, of which `master.parquet` is 20.7MB.

Registering the Parquet as DuckDB **views** instead of tables looks like the obvious fix
— let DuckDB range-request only what each query needs. It was measured against a
byte-counting server and is **twice as expensive**: 42.9MB over 12 requests versus 21.4MB
over 6, because DuckDB re-reads each file per query and caches nothing between them. The
tables are deliberate; see the comment in `src/lib/duckdb.ts`.

The real lever is the data. `master.parquet` carries far more indicators than the
dashboard reads, so splitting it into per-lens marts would cut the payload properly.
That is a pipeline change, not a frontend one.
