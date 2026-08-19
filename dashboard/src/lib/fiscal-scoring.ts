/**
 * Shared display logic for the fiscal-space composite scores — used by both the
 * index verdict and the individual pillar pages so colour semantics, verdict
 * wording, and pillar questions stay consistent.
 */

// Every score is 0–100 *relative to income-group peers*. The verdict words and
// the colours use the SAME thresholds (60 / 40) so a green bar always reads
// "strong" and a red bar always reads "constrained".
const STRONG_AT = 60;
const MODERATE_AT = 40;

/** Score → colour. red = constrained · amber = moderate · green = strong (vs peers). */
export function bandColor(score: number | null | undefined): string {
  if (score == null) return "#9ca3af";
  if (score >= STRONG_AT) return "#16a34a";
  if (score >= MODERATE_AT) return "#d97706";
  return "#dc2626";
}

/**
 * Verdict word, aligned to the colour bands. The score is peer-relative, so
 * callers should show "vs peers" context (e.g. the peer-median value) nearby.
 * Wording follows the copy audit: framed as fiscal-space room, not a grade.
 */
export function scoreVerdict(score: number): { label: string; tone: string } {
  if (score >= STRONG_AT) return { label: "More room", tone: "text-emerald-700" };
  if (score >= MODERATE_AT) return { label: "Mixed", tone: "text-amber-700" };
  return { label: "Constrained", tone: "text-red-700" };
}

/** Short pillar names for compact "also in …" overlap tags. */
export const PILLAR_SHORT: Record<string, string> = {
  macro: "Macro",
  revenue: "Revenue",
  prioritisation: "Prioritisation",
  external: "External",
  debt: "Debt",
  efficiency: "Efficiency",
  pfm: "PFM",
};

/**
 * Friendly chart-legend labels for the registry's (attribution-precise but
 * clunky) benchmark keys. Falls back to the underscore-stripped key.
 */
export const BENCHMARK_LABELS: Record<string, string> = {
  Abuja: "Abuja 15% target",
  tax_capacity_tipping_point: "15% tax-capacity floor",
  UHC_progress_guide_5pct: "5%-of-GDP UHC guide",
  essential_package_2012usd: "$86 essential package",
  heuristic_transition_watch: "donor-transition watch",
  EU_EM_line: "60% EM debt line",
  LIC_DSF_medium_capacity: "55% LIC debt line",
  EU_fiscal_rule: "−3% deficit rule",
  WHO_interim_high_coverage: "WHO high-coverage reference",
  heuristic_floor: "growth floor",
  heuristic_caution: "high-inflation line",
  midpoint: "peer midpoint",
};

export function benchmarkLabel(key: string): string {
  return BENCHMARK_LABELS[key] ?? key.replace(/_/g, " ");
}

/** Format an indicator value for display, given its registry unit. */
export function formatMetricValue(v: number, unit: string): string {
  if (unit.startsWith("US$") || unit === "intl$") {
    const a = Math.abs(v);
    if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    return `$${Math.round(v).toLocaleString()}`;
  }
  if (unit.startsWith("%")) return `${v.toFixed(1)}%`;
  if (unit === "0/1") return v >= 0.5 ? "Yes" : "No";
  return v.toFixed(unit === "years" || unit.startsWith("per ") ? 1 : 2);
}

/** Suffix shown after the value when the unit isn't already self-evident. */
export function unitSuffix(unit: string): string {
  if (!unit || unit.startsWith("US$") || unit === "intl$" || unit.startsWith("%") || unit === "0/1")
    return "";
  return unit;
}

/** Whether a latest value meets a benchmark, given the indicator's direction. */
export function benchmarkStatus(
  value: number,
  bench: number,
  direction: number
): { met: boolean; word: string } {
  if (direction <= 0) {
    // lower is better (or neutral treated as lower-is-better for thresholds)
    const met = value <= bench;
    return { met, word: met ? "within" : "above" };
  }
  const met = value >= bench;
  return { met, word: met ? "meets" : "below" };
}

/** The headline question each pillar page answers. */
export const PILLAR_QUESTIONS: Record<string, string> = {
  macro: "Is the economy expanding the resource envelope?",
  revenue: "Can the government raise more of its own revenue?",
  prioritisation: "Is health gaining priority in the public budget?",
  external: "How exposed is health financing to changes in external aid?",
  debt: "Is debt service crowding out health?",
  efficiency: "Is the country getting health outcomes for its spending?",
  pfm: "Can public funds be executed as planned?",
};
