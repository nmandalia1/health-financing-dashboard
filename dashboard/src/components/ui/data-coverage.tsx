"use client";

import { cn } from "@/lib/utils";
import type { IndicatorTimeSeries } from "@/lib/types";

interface DataCoverageProps {
  /**
   * One entry per chart series. For a single-indicator chart pass [[data]].
   * For multi-series charts pass [[series1], [series2], ...]; the indicator
   * will count years where ALL series have a data point.
   */
  series: IndicatorTimeSeries[][];
  /**
   * Short noun for what the series represent, e.g. "series", "indicators",
   * "segments". Defaults to "series" (pluralised automatically).
   */
  seriesNoun?: string;
  /**
   * Override the label displayed next to the dot. Useful for charts where
   * the standard year-coverage framing doesn't apply (e.g. radar charts).
   */
  customLabel?: string;
  className?: string;
}

export function DataCoverage({
  series,
  seriesNoun = "series",
  customLabel,
  className,
}: DataCoverageProps) {
  // Only count series that actually have data — empty series (indicator not reported
  // for this country) are excluded from the completeness intersection so they don't
  // falsely collapse the coverage to zero.
  const activeSeries = series.filter((s) => s.length > 0);

  // Flatten all data points across active series to find the overall year range
  const allYears = [...new Set(activeSeries.flatMap((s) => s.map((d) => d.year)))].sort(
    (a, b) => a - b,
  );

  if (allYears.length === 0 && !customLabel) return null;

  const earliest = allYears[0];
  const latest   = allYears[allYears.length - 1];
  const span     = earliest != null && latest != null ? latest - earliest + 1 : 0;

  // Years where every active series has a data point (inner join)
  const seriesYearSets = activeSeries.map((s) => new Set(s.map((d) => d.year)));
  const completeYears  = allYears.filter((y) => seriesYearSets.every((set) => set.has(y)));
  const missingCount   = span - completeYears.length;

  // Count how many of the originally passed series have no data at all
  const missingSeries = series.length - activeSeries.length;

  const dotColor =
    completeYears.length === 0
      ? "bg-red-500"
      : missingCount > 0 || missingSeries > 0
        ? "bg-amber-500"
        : "bg-emerald-500";

  let label: string;
  if (customLabel) {
    label = customLabel;
  } else if (activeSeries.length === 0) {
    label = "No data available for this indicator in the selected period";
  } else if (activeSeries.length === 1) {
    label =
      `${completeYears.length} of ${span} years (${earliest}–${latest}) have data` +
      (missingCount > 0
        ? ` — ${missingCount} year${missingCount === 1 ? "" : "s"} missing`
        : " — complete coverage") +
      (missingSeries > 0
        ? ` · ${missingSeries} ${missingSeries === 1 ? "series" : seriesNoun + "s"} unavailable`
        : "");
  } else {
    // "series" is already its own plural; other nouns get an "s" suffix
    const noun = seriesNoun === "series" ? "series" : `${seriesNoun}s`;
    label =
      `${completeYears.length} of ${span} years (${earliest}–${latest}) have data` +
      ` for every ${noun === "series" ? "series" : noun.replace(/s$/, "")} shown` +
      (missingCount > 0
        ? ` — ${missingCount} year${missingCount === 1 ? "" : "s"} partial/missing`
        : "") +
      (missingSeries > 0
        ? ` · ${missingSeries} ${noun} unavailable for this country`
        : "");
  }

  return (
    <div
      className={cn(
        "mt-3 flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} aria-hidden />
      <span>{label}</span>
      {completeYears.length > 0 && completeYears.length < 10 && (
        <span className="text-muted-foreground/70">
          · Years: {completeYears.join(", ")}
        </span>
      )}
    </div>
  );
}
