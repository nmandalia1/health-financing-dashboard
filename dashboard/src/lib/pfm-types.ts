/**
 * Types for the PFM (Public Financial Management) × health dashboard.
 *
 * Backed by two analytical marts produced by pipeline/analytical_marts.py:
 *   mart_pefa_health   — annual country panel with PEFA carry-forward
 *   mart_pefa_events   — raw PEFA assessment events
 *
 * The research framing (Tapsoba et al. 2024, Piatti-Fünfkirchen & Smets):
 *   - PEFA Predictability & Control in Budget Execution ↔ lower U5MR / MMR
 *   - Effect is moderated by public-financing share (Piatti 75% threshold)
 *   - Effect is moderated by overall governance (Tapsoba multiplier)
 */

/** One row from mart_pefa_health — country × year grain with carry-forward PEFA. */
export interface PfmHealthRow {
  iso3: string;
  year: number;

  // PEFA provenance
  pefa_assessment_year: number | null;
  pefa_years_since_assessment: number | null;
  pefa_framework: string | null; // "2016" | "2011" | "2011+2016"

  // Regime classification (from gghed_pct_che)
  public_financing_regime: "low (<50%)" | "mid (50-75%)" | "high (>75%)" | null;
  fcv_current: number | null; // 1 = FCV (FY26 list), else null

  // PEFA 2016 framework
  pefa_overall: number | null;
  pefa_budget_reliab: number | null;
  pefa_pillar3_pcbe: number | null;   // Predictability & Control — Tapsoba headline
  pefa_pi22_arrears: number | null;
  pefa_pi23_lastmile: number | null;  // "Resources reaching service delivery units"

  // PEFA 2011 framework (fallback)
  pefa11_overall: number | null;
  pefa11_budget_reliab: number | null;
  pefa11_pcbe: number | null;

  // Health outcomes
  u5mr: number | null;
  mmr: number | null;
  life_expectancy: number | null;
  malaria_incidence: number | null;
  neonatal_mortality: number | null;
  uhc_sci: number | null;
  uhc_rmnch: number | null;

  // Chain mediators — budget → workforce → service coverage → outcomes
  physicians_per_10k: number | null;    // medical doctors /10,000 (HWF_0001)
  nurses_per_10k: number | null;        // nursing & midwifery /10,000 (HWF_0006)
  anc4_coverage: number | null;         // ANC ≥4 visits, % (WHS4_154)
  skilled_birth_pct: number | null;     // births attended by skilled personnel, % (MDG_0000000025)
  hospital_beds_per_1k: number | null;  // hospital beds per 1,000 (SH.MED.BEDS.ZS)

  // Financing moderators (WHO GHED)
  gghed_pct_che: number | null;  // Piatti 75% threshold
  gghed_pct_gge: number | null;  // Tapsoba budget-priority moderator
  che_pct_gdp: number | null;
  gghed_pc_usd: number | null;

  // Governance moderators
  wgi_govt_effectiveness: number | null; // Tapsoba governance multiplier
  wgi_control_corruption: number | null;
  wgi_rule_of_law: number | null;
  cpia_fin_mgmt: number | null;
  cpia_irai: number | null;
}

/** One row from mart_pefa_events — one PEFA assessment with same-year outcomes joined. */
export interface PfmEventRow {
  iso3: string;
  assessment_year: number;

  // PEFA scores
  pefa_overall: number | null;
  pefa_budget_reliab: number | null;
  pefa_pillar3_pcbe: number | null;
  pefa_pi22_arrears: number | null;
  pefa_pi23_lastmile: number | null;
  pefa11_overall: number | null;
  pefa11_budget_reliab: number | null;
  pefa11_pcbe: number | null;

  // Same-year health / financing / governance
  u5mr: number | null;
  mmr: number | null;
  life_expectancy: number | null;
  malaria_incidence: number | null;
  gghed_pct_che: number | null;
  gghed_pct_gge: number | null;
  wgi_govt_effectiveness: number | null;
}

/** A point on the core PFM × outcome scatter. */
export interface PfmScatterPoint {
  iso3: string;
  country_name: string;
  income_group: string;
  region: string;
  is_ssa: boolean;
  is_fcv: boolean;

  // Axes
  pfm_score: number;         // selectable: pillar3, overall, budget_reliab, PI-23…
  outcome_value: number;     // selectable: U5MR, MMR, life_exp, malaria_incidence

  // Sizing / colouring encodings
  gghed_pct_che: number | null;
  wgi_govt_effectiveness: number | null;

  // Provenance
  year: number;
  pefa_assessment_year: number | null;
  pefa_framework: string | null;
}

/** A row for the PI-23 last-mile focus ranking. */
export interface PfmLastMileRow {
  iso3: string;
  country_name: string;
  income_group: string;
  is_ssa: boolean;
  is_fcv: boolean;
  pi23_score: number;
  pefa_assessment_year: number;
  dtp3_coverage: number | null;
  malaria_incidence: number | null;
  u5mr: number | null;
}

/**
 * A single country data point for the PFM → health mediation chain view.
 * Each country appears once; indicators are taken from the latest year
 * where the PEFA pillar-3 score is available.
 */
export interface PfmChainPoint {
  iso3: string;
  country_name: string;
  income_group: string;
  region: string;
  is_ssa: boolean;

  // PFM node (PCBE pillar, 0–4)
  pfm_score: number | null;

  // Workforce node
  physicians_per_10k: number | null;
  nurses_per_10k: number | null;
  hospital_beds_per_1k: number | null;

  // Service coverage node
  anc4_coverage: number | null;         // ANC ≥4 visits (%)
  skilled_birth_pct: number | null;     // births by skilled personnel (%)
  dtp3_coverage: number | null;         // DTP3 immunisation (%) — from WUENIC master

  // Outcomes node
  u5mr: number | null;
  mmr: number | null;

  // Moderator
  gghed_pct_che: number | null;

  year: number;
}

/**
 * Options for the core scatter — what is selectable on each axis.
 * Labels and formatting hints travel alongside the code so charts can
 * render a consistent hovertip.
 */
export const PFM_SCORE_OPTIONS = [
  {
    code: "pillar3" as const,
    label: "Predictability & Control in Budget Execution (Tapsoba pillar)",
    shortLabel: "PCBE pillar",
    // SQL expression used in queries — coalesce 2016 then 2011 framework
    sqlExpr: "COALESCE(pefa_pillar3_pcbe, pefa11_pcbe)",
    scale: "0–4 (weighted)",
  },
  {
    code: "overall" as const,
    label: "Overall PEFA (average across all PIs)",
    shortLabel: "Overall PFM",
    sqlExpr: "COALESCE(pefa_overall, pefa11_overall)",
    scale: "0–4",
  },
  {
    code: "budget_reliab" as const,
    label: "Budget reliability (PI-1..PI-3, aggregate outturn)",
    shortLabel: "Budget reliability",
    sqlExpr: "COALESCE(pefa_budget_reliab, pefa11_budget_reliab)",
    scale: "0–4",
  },
  {
    code: "pi23" as const,
    label: "PI-23 — resources reaching service-delivery units (last mile)",
    shortLabel: "PI-23 last mile",
    sqlExpr: "pefa_pi23_lastmile",
    scale: "0–4",
  },
] as const;

export type PfmScoreCode = (typeof PFM_SCORE_OPTIONS)[number]["code"];

export const PFM_OUTCOME_OPTIONS = [
  {
    code: "u5mr" as const,
    label: "Under-5 mortality rate (per 1,000 live births)",
    shortLabel: "U5MR",
    column: "u5mr",
    unit: "per 1,000",
    invertGood: true, // lower is better — used to decide slope direction in prose
  },
  {
    code: "mmr" as const,
    label: "Maternal mortality ratio (per 100,000 live births)",
    shortLabel: "MMR",
    column: "mmr",
    unit: "per 100,000",
    invertGood: true,
  },
  {
    code: "life_expectancy" as const,
    label: "Life expectancy at birth (years)",
    shortLabel: "Life expectancy",
    column: "life_expectancy",
    unit: "years",
    invertGood: false,
  },
  {
    code: "malaria_incidence" as const,
    label: "Malaria incidence (per 1,000 at-risk population)",
    shortLabel: "Malaria incidence",
    column: "malaria_incidence",
    unit: "per 1,000",
    invertGood: true,
  },
] as const;

export type PfmOutcomeCode = (typeof PFM_OUTCOME_OPTIONS)[number]["code"];
