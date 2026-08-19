/** Row from master.parquet — long-format indicator data */
export interface MasterRow {
  iso3: string;
  country_name: string;
  year: number;
  indicator_code: string;
  indicator_name: string;
  value: number;
  source: string;
}

/** Row from country_metadata.parquet */
export interface CountryMetadata {
  iso3: string;
  iso2: string;
  country_name: string;
  capital_city: string;
  latitude: number;
  longitude: number;
  wb_region_code: string;
  wb_region: string;
  wb_income_code: string;
  wb_income_group: string;
  wb_lending_type: string;
  who_region: string;
  who_region_name: string;
  unicef_region: string;
  unicef_region_name: string;
  gavi_status: string;
  gavi_phase: string;
  gavi_is_eligible: boolean;
  is_ldc: boolean;
  is_lldc: boolean;
  is_sids: boolean;
  is_fcs: boolean;
  dsa_risk_rating: string;
  dsa_is_high_risk: boolean;
  is_lmic: boolean;
  is_ssa: boolean;
  is_ida: boolean;
}

/** Country list item for selector */
export interface CountryListItem {
  iso3: string;
  country_name: string;
  wb_income_group: string;
  wb_region: string;
}

/** Single indicator time series for a country */
export interface IndicatorTimeSeries {
  year: number;
  value: number;
}

/** Multiple indicators grouped by code */
export interface IndicatorGroup {
  [indicatorCode: string]: IndicatorTimeSeries[];
}

/** Scatter plot data point */
export interface ScatterPoint {
  iso3: string;
  country_name: string;
  x: number;
  y: number;
  income_group: string;
}

/** One row of peer-group percentile bands for a given year */
export interface PercentileBand {
  year: number;
  p25: number;
  p50: number;
  p75: number;
  n: number;
}

/** Peer bands grouped by indicator code */
export type PeerBandGroup = Record<string, PercentileBand[]>;

/** Year-tagged scatter point for the animated efficiency scatter */
export interface AnimatedScatterPoint extends ScatterPoint {
  year: number;
}

/**
 * Row from mart_fiscal_space.parquet — the fiscal-space composite scores.
 * Pillar columns follow `pillar_<key>_score` / `pillar_<key>_coverage`, hence
 * the index signature alongside the named composite fields.
 */
export interface FiscalCompositeRow {
  year: number;
  fsh_index: number | null;
  fsh_index_coverage: number | null;
  crowding_out_ratio: number | null;
  transition_risk_score: number | null;
  [pillarColumn: string]: number | null;
}

/** Latest-per-peer median of each composite column, for the same income group */
export type FiscalPeerMedians = Record<string, number | null>;

/**
 * One indicator's peer-normalised (0–100) contribution to a pillar score, from
 * mart_fiscal_components. `code` may be a pseudo-code for the efficiency proxy
 * (`_outcome_attainment`, `_spend_level`).
 */
export interface FiscalComponentRow {
  code: string;
  norm_score: number;
}

/** Latest value for one indicator across all countries — feeds the world choropleth */
export interface ChoroplethPoint {
  iso3: string;
  country_name: string;
  value: number;
  year: number;
  income_group: string;
  region: string;
}
