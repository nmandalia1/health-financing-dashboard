/**
 * SQL queries against the PFM marts (mart_pefa_health, mart_pefa_events).
 *
 * Every query selects the *latest country-year row where the relevant
 * PEFA score is present* rather than the overall latest year, so we
 * don't compare old PEFA scores against brand-new mortality figures in
 * a misleading way.
 */
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type {
  PfmChainPoint,
  PfmEventRow,
  PfmHealthRow,
  PfmLastMileRow,
  PfmOutcomeCode,
  PfmScatterPoint,
  PfmScoreCode,
} from "./pfm-types";
import { PFM_OUTCOME_OPTIONS, PFM_SCORE_OPTIONS } from "./pfm-types";

// DuckDB-WASM query results expose toArray(); BigInt values must be coerced.
function toRows<T>(result: { toArray: () => unknown[] }): T[] {
  return result.toArray().map((row) => {
    const obj = row as Record<string, unknown>;
    const plain: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      plain[key] = typeof val === "bigint" ? Number(val) : val;
    }
    return plain as T;
  });
}

/** Quick existence check — returns false if the mart wasn't loaded. */
export async function pfmMartsAvailable(
  conn: AsyncDuckDBConnection,
): Promise<boolean> {
  try {
    await conn.query(`SELECT 1 FROM mart_pefa_health LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Core scatter data: one point per country, using the latest observation
 * where both the selected PFM score and the selected outcome are present.
 */
export async function getPfmScatter(
  conn: AsyncDuckDBConnection,
  scoreCode: PfmScoreCode,
  outcomeCode: PfmOutcomeCode,
  opts: { ssaOnly?: boolean; minYear?: number } = {},
): Promise<PfmScatterPoint[]> {
  const score = PFM_SCORE_OPTIONS.find((s) => s.code === scoreCode)!;
  const outcome = PFM_OUTCOME_OPTIONS.find((o) => o.code === outcomeCode)!;
  const minYear = opts.minYear ?? 2005;

  // Pre-compute the coalesced PFM expression as `pfm_score` in a CTE so we
  // can reference it by name in ROW_NUMBER and SELECT without repeating.
  const sql = `
    WITH base AS (
      SELECT
        m.iso3,
        m.year,
        ${score.sqlExpr} AS pfm_score,
        m.${outcome.column} AS outcome_value,
        m.gghed_pct_che,
        m.wgi_govt_effectiveness,
        m.pefa_assessment_year,
        m.pefa_framework
      FROM mart_pefa_health m
      WHERE ${score.sqlExpr} IS NOT NULL
        AND m.${outcome.column} IS NOT NULL
        AND m.year >= ${minYear}
    ),
    latest AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY iso3 ORDER BY year DESC) AS rn
      FROM base
    )
    SELECT
      l.iso3,
      cm.country_name,
      COALESCE(cm.wb_income_group, 'Not classified') AS income_group,
      COALESCE(cm.wb_region, 'Unknown') AS region,
      COALESCE(cm.is_ssa, FALSE) AS is_ssa,
      COALESCE(cm.is_fcs, FALSE) AS is_fcv,
      l.pfm_score,
      l.outcome_value,
      l.gghed_pct_che,
      l.wgi_govt_effectiveness,
      l.year,
      l.pefa_assessment_year,
      l.pefa_framework
    FROM latest l
    JOIN country_metadata cm ON l.iso3 = cm.iso3
    WHERE l.rn = 1
      ${opts.ssaOnly ? "AND cm.is_ssa = TRUE" : ""}
    ORDER BY cm.country_name
  `;
  const result = await conn.query(sql);
  return toRows<PfmScatterPoint>(result);
}

/** All PEFA assessment events for one country (for timeline view). */
export async function getPfmEventsForCountry(
  conn: AsyncDuckDBConnection,
  iso3: string,
): Promise<PfmEventRow[]> {
  const stmt = await conn.prepare(`
    SELECT *
    FROM mart_pefa_events
    WHERE iso3 = $1
    ORDER BY assessment_year
  `);
  const result = await stmt.query(iso3);
  return toRows<PfmEventRow>(result);
}

/** Annual country-year time series for the drill-down view. */
export async function getPfmTimelineForCountry(
  conn: AsyncDuckDBConnection,
  iso3: string,
): Promise<PfmHealthRow[]> {
  const stmt = await conn.prepare(`
    SELECT *
    FROM mart_pefa_health
    WHERE iso3 = $1
    ORDER BY year
  `);
  const result = await stmt.query(iso3);
  return toRows<PfmHealthRow>(result);
}

/**
 * Ranking for the PI-23 last-mile view. Latest assessment per country
 * with a PI-23 score, joined with DTP3 coverage and malaria incidence
 * from the same year (from the master table).
 */
export async function getPfmLastMileRanking(
  conn: AsyncDuckDBConnection,
): Promise<PfmLastMileRow[]> {
  const sql = `
    WITH latest AS (
      SELECT iso3, assessment_year, pefa_pi23_lastmile, malaria_incidence, u5mr,
             ROW_NUMBER() OVER (PARTITION BY iso3 ORDER BY assessment_year DESC) AS rn
      FROM mart_pefa_events
      WHERE pefa_pi23_lastmile IS NOT NULL
    ),
    dtp3 AS (
      SELECT iso3, year AS assessment_year, value AS dtp3_coverage
      FROM master
      WHERE indicator_code = 'WUENIC_DTP3'
    )
    SELECT
      l.iso3,
      cm.country_name,
      COALESCE(cm.wb_income_group, 'Not classified') AS income_group,
      COALESCE(cm.is_ssa, FALSE) AS is_ssa,
      COALESCE(cm.is_fcs, FALSE) AS is_fcv,
      l.pefa_pi23_lastmile AS pi23_score,
      l.assessment_year AS pefa_assessment_year,
      d.dtp3_coverage,
      l.malaria_incidence,
      l.u5mr
    FROM latest l
    JOIN country_metadata cm ON l.iso3 = cm.iso3
    LEFT JOIN dtp3 d ON l.iso3 = d.iso3 AND l.assessment_year = d.assessment_year
    WHERE l.rn = 1
    ORDER BY l.pefa_pi23_lastmile DESC, cm.country_name
  `;
  const result = await conn.query(sql);
  return toRows<PfmLastMileRow>(result);
}

/**
 * Country list filtered to those with at least one PEFA assessment —
 * used for the PFM country selector.
 */
export async function getPfmCountryList(
  conn: AsyncDuckDBConnection,
): Promise<Array<{ iso3: string; country_name: string; n_assessments: number }>> {
  const sql = `
    SELECT
      e.iso3,
      cm.country_name,
      COUNT(*) AS n_assessments
    FROM mart_pefa_events e
    JOIN country_metadata cm ON e.iso3 = cm.iso3
    GROUP BY e.iso3, cm.country_name
    ORDER BY cm.country_name
  `;
  const result = await conn.query(sql);
  return toRows<{ iso3: string; country_name: string; n_assessments: number }>(result);
}

/**
 * Budget → health mediation chain.
 * Returns one row per country (latest year where PEFA pillar-3 is present),
 * with workforce, service-coverage, and outcomes alongside.
 * DTP3 coverage is joined from the WUENIC master table at the same year.
 */
export async function getPfmChainData(
  conn: AsyncDuckDBConnection,
  opts: { ssaOnly?: boolean } = {},
): Promise<PfmChainPoint[]> {
  const sql = `
    WITH pfm_latest AS (
      SELECT
        m.iso3,
        m.year,
        COALESCE(m.pefa_pillar3_pcbe, m.pefa11_pcbe) AS pfm_score,
        m.physicians_per_10k,
        m.nurses_per_10k,
        m.hospital_beds_per_1k,
        m.anc4_coverage,
        m.skilled_birth_pct,
        m.u5mr,
        m.mmr,
        m.gghed_pct_che,
        ROW_NUMBER() OVER (PARTITION BY m.iso3 ORDER BY m.year DESC) AS rn
      FROM mart_pefa_health m
      WHERE COALESCE(m.pefa_pillar3_pcbe, m.pefa11_pcbe) IS NOT NULL
    ),
    dtp3 AS (
      SELECT iso3, year, value AS dtp3_coverage
      FROM master
      WHERE indicator_code = 'WUENIC_DTP3'
    )
    SELECT
      l.iso3,
      cm.country_name,
      COALESCE(cm.wb_income_group, 'Not classified') AS income_group,
      COALESCE(cm.wb_region, 'Unknown') AS region,
      COALESCE(cm.is_ssa, FALSE) AS is_ssa,
      l.pfm_score,
      l.physicians_per_10k,
      l.nurses_per_10k,
      l.hospital_beds_per_1k,
      l.anc4_coverage,
      l.skilled_birth_pct,
      d.dtp3_coverage,
      l.u5mr,
      l.mmr,
      l.gghed_pct_che,
      l.year
    FROM pfm_latest l
    JOIN country_metadata cm ON l.iso3 = cm.iso3
    LEFT JOIN dtp3 d ON l.iso3 = d.iso3 AND l.year = d.year
    WHERE l.rn = 1
      ${opts.ssaOnly ? "AND cm.is_ssa = TRUE" : ""}
    ORDER BY cm.country_name
  `;
  const result = await conn.query(sql);
  return toRows<PfmChainPoint>(result);
}

/** Pearson correlation helper — runs in DuckDB so we don't ship scipy. */
export async function getPfmCorrelation(
  conn: AsyncDuckDBConnection,
  scoreCode: PfmScoreCode,
  outcomeCode: PfmOutcomeCode,
  opts: { ssaOnly?: boolean; financingRegime?: "low" | "mid" | "high" } = {},
): Promise<{ r: number | null; n: number }> {
  const score = PFM_SCORE_OPTIONS.find((s) => s.code === scoreCode)!;
  const outcome = PFM_OUTCOME_OPTIONS.find((o) => o.code === outcomeCode)!;

  const regimeFilter =
    opts.financingRegime === "high"
      ? "AND m.gghed_pct_che > 75"
      : opts.financingRegime === "mid"
      ? "AND m.gghed_pct_che BETWEEN 50 AND 75"
      : opts.financingRegime === "low"
      ? "AND m.gghed_pct_che < 50"
      : "";

  const sql = `
    WITH base AS (
      SELECT
        m.iso3,
        m.year,
        ${score.sqlExpr} AS x,
        m.${outcome.column} AS y
      FROM mart_pefa_health m
      JOIN country_metadata cm ON m.iso3 = cm.iso3
      WHERE ${score.sqlExpr} IS NOT NULL
        AND m.${outcome.column} IS NOT NULL
        ${opts.ssaOnly ? "AND cm.is_ssa = TRUE" : ""}
        ${regimeFilter}
    ),
    latest AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY iso3 ORDER BY year DESC) AS rn FROM base
    )
    SELECT CORR(x, y) AS r, COUNT(*) AS n
    FROM latest WHERE rn = 1
  `;
  const result = await conn.query(sql);
  const [row] = toRows<{ r: number | null; n: number }>(result);
  return row ?? { r: null, n: 0 };
}
