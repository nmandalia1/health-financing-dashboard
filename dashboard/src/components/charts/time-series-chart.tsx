"use client";

import { PlotlyChart } from "./plotly-chart";
import { NoData } from "@/components/ui/no-data";
import { makeBandTraces } from "@/lib/peer-band-utils";
import type { IndicatorTimeSeries, PercentileBand } from "@/lib/types";

export interface TimeSeriesLine {
  name: string;
  data: IndicatorTimeSeries[];
  color?: string;
  dash?: "solid" | "dot" | "dash";
  /** Plotly scatter mode. Defaults to "lines". */
  mode?: "lines" | "lines+markers" | "markers";
  /**
   * Full Plotly Y-value format expression used in the hover tooltip.
   * Defaults to "%{y:.1f}".
   *
   * Examples:
   *   "%{y:.1f}%"          — percentage (14.2%)
   *   "$%{y:,.0f}"         — currency ($1,234)
   *   "%{y:.1f} per 1,000" — density
   */
  hoverValue?: string;
}

export interface PeerBandProps {
  /** Percentile band data (P25 / P50 / P75 per year). */
  data: PercentileBand[];
  /** Label for the income group, shown in legend and hover. */
  incomeGroup: string;
  /** Band colour (hex). Defaults to neutral grey. */
  color?: string;
}

interface TimeSeriesChartProps {
  lines: TimeSeriesLine[];
  yAxisTitle?: string;
  /**
   * Horizontal benchmark line (e.g., Abuja 15%, WHO 20%).
   * Set `unit` to append a unit suffix to the hover value (e.g. "%").
   */
  benchmark?: { value: number; label: string; color?: string; unit?: string };
  /**
   * Optional income-group peer band overlay.
   * Renders a P25–P75 shaded region behind the main lines.
   */
  peerBand?: PeerBandProps;
  className?: string;
}

export function TimeSeriesChart({
  lines,
  yAxisTitle,
  benchmark,
  peerBand,
  className,
}: TimeSeriesChartProps) {
  // ── Empty-data guard: render fallback rather than blank axes ───────────────
  const hasAnyData = lines.some((l) => l.data.length > 0);
  if (!hasAnyData) {
    return (
      <div className={className}>
        <NoData variant="chart" label="time-series data" />
      </div>
    );
  }

  // ── Peer band traces (rendered first, so they sit behind main lines) ───────
  const bandTraces = peerBand?.data?.length
    ? makeBandTraces(peerBand.data, {
        incomeGroup: peerBand.incomeGroup,
        color: peerBand.color ?? "#9ca3af",
      })
    : [];

  // ── Primary line traces ───────────────────────────────────────────────────
  const lineTraces = lines.map((line) => ({
    x: line.data.map((d) => d.year),
    y: line.data.map((d) => d.value),
    name: line.name,
    type: "scatter" as const,
    mode: (line.mode ?? "lines") as "lines" | "lines+markers" | "markers",
    line: {
      color: line.color || "#2563eb",
      width: 2,
      dash: line.dash || ("solid" as const),
    },
    marker: {
      color: line.color || "#2563eb",
      size: 5,
    },
    hovertemplate: `%{x}: ${line.hoverValue ?? "%{y:.1f}"}<extra>${line.name}</extra>`,
  }));

  // ── Benchmark flat line ───────────────────────────────────────────────────
  const allYears = lines.flatMap((l) => l.data.map((d) => d.year));
  const benchmarkTraces =
    benchmark && allYears.length > 0
      ? [
          {
            x: [Math.min(...allYears), Math.max(...allYears)],
            y: [benchmark.value, benchmark.value],
            name: benchmark.label,
            type: "scatter" as const,
            mode: "lines" as const,
            line: {
              color: benchmark.color || "#9ca3af",
              width: 1.5,
              dash: "dash" as const,
            },
            hovertemplate: `${benchmark.label}: ${benchmark.value}${benchmark.unit ?? ""}<extra></extra>`,
          },
        ]
      : [];

  return (
    <PlotlyChart
      className={className}
      data={[...bandTraces, ...lineTraces, ...benchmarkTraces]}
      layout={{
        yaxis: { title: { text: yAxisTitle } },
        hovermode: "x unified" as const,
      }}
    />
  );
}
