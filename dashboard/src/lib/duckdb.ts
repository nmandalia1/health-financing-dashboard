import * as duckdb from "@duckdb/duckdb-wasm";

/**
 * Where the Parquet files are served from.
 *
 * Defaults to this origin's /data, so local development and a self-contained
 * deploy both work with no configuration. Point NEXT_PUBLIC_DATA_BASE_URL at a
 * bucket (R2/S3) to decouple the data from the app: a refresh then becomes an
 * upload, with no rebuild, no redeploy, and no 20MB binaries in git history.
 *
 * The bucket must allow cross-origin GETs and, for the lazy VIEW registration
 * below, HTTP range requests — R2 and S3 both do.
 */
function dataBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DATA_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${window.location.origin}/data`;
}

/**
 * Where the DuckDB WASM runtime is served from.
 *
 * Unset, this falls back to jsDelivr, which is how the library ships by
 * default — convenient, but it makes the whole dashboard depend on a
 * third-party CDN at runtime: if jsDelivr is unreachable (corporate and
 * government networks routinely block public CDNs, which is much of this
 * audience) the app hangs on a loading spinner forever.
 *
 * Set NEXT_PUBLIC_DUCKDB_BASE_URL to serve the bundles yourself. They are
 * 34–39MB each uncompressed, so a bucket is the right home rather than the
 * app deploy — Cloudflare Pages rejects individual files above ~25MiB.
 * `scripts/publish-data.sh --with-runtime` uploads them.
 */
function duckdbBundles(): duckdb.DuckDBBundles {
  const base = process.env.NEXT_PUBLIC_DUCKDB_BASE_URL?.trim();
  if (!base) return duckdb.getJsDelivrBundles();

  const root = base.replace(/\/+$/, "");
  return {
    mvp: {
      mainModule: `${root}/duckdb-mvp.wasm`,
      mainWorker: `${root}/duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${root}/duckdb-eh.wasm`,
      mainWorker: `${root}/duckdb-browser-eh.worker.js`,
    },
  };
}

let dbPromise: Promise<{
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
}> | null = null;

export async function initDuckDB() {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const bundle = await duckdb.selectBundle(duckdbBundles());

    const worker = await duckdb.createWorker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    const conn = await db.connect();
    const base = dataBaseUrl();

    /**
     * Materialised as TABLEs, deliberately.
     *
     * Registering these as VIEWs looks like the obvious optimisation — let
     * DuckDB range-request only what each query needs instead of pulling ~21MB
     * up front. Measured against a byte-counting server, it is twice as
     * expensive: one cold page load moved 21.4MB over 6 requests as tables,
     * and 42.9MB over 12 as views. DuckDB re-reads each file per query and
     * caches nothing between them, so every view costs a fresh full read.
     *
     * If the cold-load payload needs to come down, the lever is the data, not
     * the registration: master.parquet is 21MB of the 21.4MB total and holds
     * far more indicators than the dashboard reads. Splitting it into
     * per-lens marts would cut this properly.
     */
    await conn.query(`
      CREATE TABLE IF NOT EXISTS master AS
      SELECT * FROM read_parquet('${base}/master.parquet')
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS country_metadata AS
      SELECT * FROM read_parquet('${base}/country_metadata.parquet')
    `);

    // PFM marts — optional (pipeline must have run the PEFA ingestion first).
    // If the files are missing, the PFM routes render a "no data yet" state
    // rather than crashing the whole dashboard.
    const optionalMarts: Array<[string, string]> = [
      ["mart_pefa_health", "mart_pefa_health.parquet"],
      ["mart_pefa_events", "mart_pefa_events.parquet"],
      ["mart_fiscal_space", "mart_fiscal_space.parquet"],
      ["mart_fiscal_components", "mart_fiscal_components.parquet"],
    ];
    for (const [table, filename] of optionalMarts) {
      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS ${table} AS
          SELECT * FROM read_parquet('${base}/${filename}')
        `);
      } catch (err) {
        console.warn(`PFM mart ${filename} not available — /pfm routes will show empty state.`, err);
      }
    }

    return { db, conn };
  })();

  return dbPromise;
}
