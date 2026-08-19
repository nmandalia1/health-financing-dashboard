import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type {
  AnimatedScatterPoint,
  ChoroplethPoint,
  CountryListItem,
  CountryMetadata,
  FiscalComponentRow,
  FiscalCompositeRow,
  FiscalPeerMedians,
  IndicatorGroup,
  IndicatorTimeSeries,
  PeerBandGroup,
  ScatterPoint,
} from "./types";

/** Pillar keys, in display order — mirror of PILLARS in indicator-registry.ts */
export const FISCAL_PILLAR_KEYS = [
  "macro",
  "revenue",
  "prioritisation",
  "external",
  "debt",
  "efficiency",
  "pfm",
] as const;

const FISCAL_COMPOSITE_COLUMNS = [
  "year",
  "fsh_index",
  "fsh_index_coverage",
  "crowding_out_ratio",
  "transition_risk_score",
  ...FISCAL_PILLAR_KEYS.flatMap((k) => [`pillar_${k}_score`, `pillar_${k}_coverage`]),
].join(", ");

function toRows<T>(result: { toArray: () => unknown[] }): T[] {
  return result.toArray().map((row) => {
    const obj = row as Record<string, unknown>;
    // DuckDB-WASM returns proxy objects with BigInt values — convert to plain JS
    const plain: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      plain[key] = typeof val === "bigint" ? Number(val) : val;
    }
    return plain as T;
  });
}

/** All countries for the selector */
export async function getCountryList(
  conn: AsyncDuckDBConnection
): Promise<CountryListItem[]> {
  const result = await conn.query(`
    SELECT iso3, country_name, wb_income_group, wb_region
    FROM country_metadata
    ORDER BY country_name
  `);
  return toRows<CountryListItem>(result);
}

/** Full metadata for a single country */
export async function getCountryMetadata(
  conn: AsyncDuckDBConnection,
  iso3: string
): Promise<CountryMetadata | null> {
  const stmt = await conn.prepare(`
    SELECT * FROM country_metadata WHERE iso3 = $1
  `);
  const result = await stmt.query(iso3);
  const rows = toRows<CountryMetadata>(result);
  return rows[0] ?? null;
}

/** Time series for one indicator in one country */
export async function getIndicatorTimeSeries(
  conn: AsyncDuckDBConnection,
  iso3: string,
  indicatorCode: string
): Promise<IndicatorTimeSeries[]> {
  const stmt = await conn.prepare(`
    SELECT year, value
    FROM master
    WHERE iso3 = $1 AND indicator_code = $2 AND value IS NOT NULL
    ORDER BY year
  `);
  const result = await stmt.query(iso3, indicatorCode);
  return toRows<IndicatorTimeSeries>(result);
}

/** Multiple indicators for one country, grouped by indicator_code */
export async function getMultipleIndicators(
  conn: AsyncDuckDBConnection,
  iso3: string,
  indicatorCodes: string[]
): Promise<IndicatorGroup> {
  const placeholders = indicatorCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(", ");
  const result = await conn.query(`
    SELECT year, indicator_code, value
    FROM master
    WHERE iso3 = '${iso3.replace(/'/g, "''")}'
      AND indicator_code IN (${placeholders})
      AND value IS NOT NULL
    ORDER BY indicator_code, year
  `);

  const rows = toRows<{ year: number; indicator_code: string; value: number }>(
    result
  );

  const grouped: IndicatorGroup = {};
  for (const row of rows) {
    if (!grouped[row.indicator_code]) {
      grouped[row.indicator_code] = [];
    }
    grouped[row.indicator_code].push({ year: row.year, value: row.value });
  }
  return grouped;
}

/** Most recent non-null value for an indicator */
export async function getLatestValue(
  conn: AsyncDuckDBConnection,
  iso3: string,
  indicatorCode: string
): Promise<{ year: number; value: number } | null> {
  const stmt = await conn.prepare(`
    SELECT year, value
    FROM master
    WHERE iso3 = $1 AND indicator_code = $2 AND value IS NOT NULL
    ORDER BY year DESC
    LIMIT 1
  `);
  const result = await stmt.query(iso3, indicatorCode);
  const rows = toRows<{ year: number; value: number }>(result);
  return rows[0] ?? null;
}

/**
 * Income-group percentile bands for a set of indicators.
 * Returns P25 / P50 / P75 per year for all countries sharing the
 * same wb_income_group. Years with fewer than 3 data points are excluded.
 */
export async function getPeerPercentiles(
  conn: AsyncDuckDBConnection,
  incomeGroup: string,
  indicatorCodes: string[]
): Promise<PeerBandGroup> {
  if (indicatorCodes.length === 0) return {};
  const placeholders = indicatorCodes
    .map((c) => `'${c.replace(/'/g, "''")}'`)
    .join(", ");
  const safeGroup = incomeGroup.replace(/'/g, "''");
  const result = await conn.query(`
    SELECT
      m.indicator_code,
      m.year,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY m.value) AS p25,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY m.value) AS p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY m.value) AS p75,
      COUNT(*) AS n
    FROM master m
    JOIN country_metadata cm ON m.iso3 = cm.iso3
    WHERE m.indicator_code IN (${placeholders})
      AND cm.wb_income_group = '${safeGroup}'
      AND m.value IS NOT NULL
    GROUP BY m.indicator_code, m.year
    HAVING COUNT(*) >= 3
    ORDER BY m.indicator_code, m.year
  `);
  const rows = toRows<{
    indicator_code: string;
    year: number;
    p25: number;
    p50: number;
    p75: number;
    n: number;
  }>(result);
  const grouped: PeerBandGroup = {};
  for (const row of rows) {
    if (!grouped[row.indicator_code]) grouped[row.indicator_code] = [];
    grouped[row.indicator_code].push({
      year: row.year,
      p25: row.p25,
      p50: row.p50,
      p75: row.p75,
      n: row.n,
    });
  }
  return grouped;
}

/**
 * Latest non-null value per country for one indicator, within an optional year window.
 * Feeds the landing-page choropleth map.
 */
export async function getChoroplethData(
  conn: AsyncDuckDBConnection,
  indicatorCode: string,
  sinceYear = 2015
): Promise<ChoroplethPoint[]> {
  const safeCode = indicatorCode.replace(/'/g, "''");
  const result = await conn.query(`
    WITH latest AS (
      SELECT iso3, year, value,
             ROW_NUMBER() OVER (PARTITION BY iso3 ORDER BY year DESC) AS rn
      FROM master
      WHERE indicator_code = '${safeCode}'
        AND value IS NOT NULL
        AND year >= ${sinceYear}
    )
    SELECT
      l.iso3,
      cm.country_name,
      l.value,
      l.year,
      cm.wb_income_group AS income_group,
      cm.wb_region AS region
    FROM latest l
    JOIN country_metadata cm ON l.iso3 = cm.iso3
    WHERE l.rn = 1
    ORDER BY cm.country_name
  `);
  return toRows<ChoroplethPoint>(result);
}

/**
 * All (country, year) observations where BOTH x and y indicators have a value.
 * Feeds the animated efficiency scatter (2000–2023 year scrubber).
 */
export async function getAnimatedScatterData(
  conn: AsyncDuckDBConnection,
  xIndicator: string,
  yIndicator: string
): Promise<AnimatedScatterPoint[]> {
  const safeX = xIndicator.replace(/'/g, "''");
  const safeY = yIndicator.replace(/'/g, "''");
  const result = await conn.query(`
    WITH x AS (
      SELECT iso3, year, value AS x
      FROM master
      WHERE indicator_code = '${safeX}' AND value IS NOT NULL
    ),
    y AS (
      SELECT iso3, year, value AS y
      FROM master
      WHERE indicator_code = '${safeY}' AND value IS NOT NULL
    )
    SELECT
      x.iso3,
      cm.country_name,
      x.year,
      x.x,
      y.y,
      cm.wb_income_group AS income_group
    FROM x
    JOIN y ON x.iso3 = y.iso3 AND x.year = y.year
    JOIN country_metadata cm ON x.iso3 = cm.iso3
    ORDER BY x.year, cm.country_name
  `);
  return toRows<AnimatedScatterPoint>(result);
}

/**
 * One indicator across multiple countries — returned as year/iso3/value rows.
 * Feeds the /compare multi-country time-series chart.
 */
export async function getMultiCountryIndicator(
  conn: AsyncDuckDBConnection,
  iso3Codes: string[],
  indicatorCode: string
): Promise<Array<{ iso3: string; year: number; value: number }>> {
  if (iso3Codes.length === 0) return [];
  const isoPlaceholders = iso3Codes
    .map((c) => `'${c.replace(/'/g, "''")}'`)
    .join(", ");
  const safeCode = indicatorCode.replace(/'/g, "''");
  const result = await conn.query(`
    SELECT iso3, year, value
    FROM master
    WHERE iso3 IN (${isoPlaceholders})
      AND indicator_code = '${safeCode}'
      AND value IS NOT NULL
    ORDER BY iso3, year
  `);
  return toRows<{ iso3: string; year: number; value: number }>(result);
}

/** Scatter data: latest values for x and y indicators across all countries */
export async function getScatterData(
  conn: AsyncDuckDBConnection,
  xIndicator: string,
  yIndicator: string
): Promise<ScatterPoint[]> {
  const result = await conn.query(`
    WITH latest_x AS (
      SELECT iso3, value AS x,
             ROW_NUMBER() OVER (PARTITION BY iso3 ORDER BY year DESC) AS rn
      FROM master
      WHERE indicator_code = '${xIndicator.replace(/'/g, "''")}' AND value IS NOT NULL
    ),
    latest_y AS (
      SELECT iso3, value AS y,
             ROW_NUMBER() OVER (PARTITION BY iso3 ORDER BY year DESC) AS rn
      FROM master
      WHERE indicator_code = '${yIndicator.replace(/'/g, "''")}' AND value IS NOT NULL
    )
    SELECT
      lx.iso3,
      cm.country_name,
      lx.x,
      ly.y,
      cm.wb_income_group AS income_group
    FROM latest_x lx
    JOIN latest_y ly ON lx.iso3 = ly.iso3 AND ly.rn = 1
    JOIN country_metadata cm ON lx.iso3 = cm.iso3
    WHERE lx.rn = 1
    ORDER BY cm.country_name
  `);
  return toRows<ScatterPoint>(result);
}

/** Income group average for one indicator over time */
export async function getIncomeGroupAverage(
  conn: AsyncDuckDBConnection,
  incomeGroup: string,
  indicatorCode: string
): Promise<Array<{ year: number; value: number }>> {
  const safeGroup = incomeGroup.replace(/'/g, "''");
  const safeCode = indicatorCode.replace(/'/g, "''");
  const result = await conn.query(`
    SELECT m.year, AVG(m.value) AS value
    FROM master m
    JOIN country_metadata cm ON m.iso3 = cm.iso3
    WHERE cm.wb_income_group = '${safeGroup}'
      AND m.indicator_code = '${safeCode}'
      AND m.value IS NOT NULL
    GROUP BY m.year
    ORDER BY m.year
  `);
  return toRows<{ year: number; value: number }>(result);
}

/**
 * Fiscal-space composite time series for one country (from mart_fiscal_space).
 * Returns all years; the caller picks the latest row with a published index.
 */
export async function getFiscalComposites(
  conn: AsyncDuckDBConnection,
  iso3: string
): Promise<FiscalCompositeRow[]> {
  const result = await conn.query(`
    SELECT ${FISCAL_COMPOSITE_COLUMNS}
    FROM mart_fiscal_space
    WHERE iso3 = '${iso3.replace(/'/g, "''")}'
    ORDER BY year
  `);
  return toRows<FiscalCompositeRow>(result);
}

/**
 * Peer-group median of each composite, taken over the latest published row per
 * country within the same World Bank income group. Feeds the "vs peers"
 * markers on the pillar breakdown.
 */
export async function getFiscalPeerMedians(
  conn: AsyncDuckDBConnection,
  incomeGroup: string
): Promise<FiscalPeerMedians | null> {
  const safeGroup = incomeGroup.replace(/'/g, "''");
  const medianCols = [
    "fsh_index",
    ...FISCAL_PILLAR_KEYS.map((k) => `pillar_${k}_score`),
  ]
    .map((c) => `median(${c}) AS ${c}`)
    .join(", ");
  const result = await conn.query(`
    WITH latest AS (
      SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.iso3 ORDER BY m.year DESC) AS rn
      FROM mart_fiscal_space m
      JOIN country_metadata cm ON m.iso3 = cm.iso3
      WHERE cm.wb_income_group = '${safeGroup}' AND m.fsh_index IS NOT NULL
    )
    SELECT ${medianCols}
    FROM latest
    WHERE rn = 1
  `);
  const rows = toRows<FiscalPeerMedians>(result);
  return rows[0] ?? null;
}

/**
 * The per-indicator component scores that build a pillar's sub-index, for one
 * country and year (from mart_fiscal_components). Ordered strongest-first.
 */
export async function getFiscalComponents(
  conn: AsyncDuckDBConnection,
  iso3: string,
  pillar: string,
  year: number
): Promise<FiscalComponentRow[]> {
  const result = await conn.query(`
    SELECT code, norm_score
    FROM mart_fiscal_components
    WHERE iso3 = '${iso3.replace(/'/g, "''")}'
      AND pillar = '${pillar.replace(/'/g, "''")}'
      AND year = ${Math.trunc(year)}
    ORDER BY norm_score DESC
  `);
  return toRows<FiscalComponentRow>(result);
}

/** All countries in an income group for one indicator */
export async function getIncomeGroupCountries(
  conn: AsyncDuckDBConnection,
  incomeGroup: string
): Promise<CountryListItem[]> {
  const safeGroup = incomeGroup.replace(/'/g, "''");
  const result = await conn.query(`
    SELECT iso3, country_name, wb_income_group, wb_region
    FROM country_metadata
    WHERE wb_income_group = '${safeGroup}'
    ORDER BY country_name
  `);
  return toRows<CountryListItem>(result);
}
