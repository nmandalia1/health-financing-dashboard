import type { IndicatorTimeSeries } from "./types";

/**
 * Filter a time series to only include data points within [startYear, endYear].
 */
export function filterByYears(
  data: IndicatorTimeSeries[],
  startYear: number,
  endYear: number
): IndicatorTimeSeries[] {
  return data.filter((d) => d.year >= startYear && d.year <= endYear);
}

/**
 * Filter an entire indicator map (all series at once).
 */
export function filterDataByYears(
  data: Record<string, IndicatorTimeSeries[]>,
  startYear: number,
  endYear: number
): Record<string, IndicatorTimeSeries[]> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, filterByYears(v, startYear, endYear)])
  );
}
