"use client";

import type { Data } from "plotly.js-dist-min";
import { PlotlyChart } from "./plotly-chart";
import { FINANCING_COLORS } from "./chart-config";
import { NoData } from "@/components/ui/no-data";
import type { IndicatorTimeSeries } from "@/lib/types";

interface StackedAreaSeries {
  name: string;
  data: IndicatorTimeSeries[];
  colorKey: keyof typeof FINANCING_COLORS;
  /** Short source label surfaced in the tooltip (e.g. "WHO GHED") */
  source?: string;
}

interface StackedAreaChartProps {
  series: StackedAreaSeries[];
  /** Optional line overlay on secondary y-axis */
  overlay?: {
    name: string;
    data: IndicatorTimeSeries[];
    unit?: string;
    source?: string;
  };
  yAxisTitle?: string;
  className?: string;
}

export function StackedAreaChart({
  series,
  overlay,
  yAxisTitle = "% of current health expenditure",
  className,
}: StackedAreaChartProps) {
  // Empty-data guard: if every series is empty, render a friendly fallback
  // instead of Plotly's blank axes.
  const hasAnyData = series.some((s) => s.data.length > 0);
  if (!hasAnyData) {
    return (
      <div className={className}>
        <NoData
          variant="chart"
          label="financing breakdown"
          hint="No SHA 2011 revenue-source data is reported for this country over the displayed period."
        />
      </div>
    );
  }

  const traces: Data[] = series.map((s) => {
    const sourceSuffix = s.source
      ? `  <span style="color:#9ca3af">· ${s.source}</span>`
      : "";
    return {
      x: s.data.map((d) => d.year),
      y: s.data.map((d) => d.value),
      name: s.name,
      type: "scatter" as const,
      mode: "lines+markers" as const,
      marker: { size: 5, color: FINANCING_COLORS[s.colorKey] },
      stackgroup: "financing",
      fillcolor:
        s.colorKey === "private"
          ? `${FINANCING_COLORS[s.colorKey]}55`
          : `${FINANCING_COLORS[s.colorKey]}44`,
      line: { color: FINANCING_COLORS[s.colorKey], width: 1.5 },
      // Compact line per trace in x-unified tooltip:
      // "Government (GGHE-D): 43.1% of CHE · WHO GHED"
      hovertemplate: `<b>${s.name}</b>: %{y:.1f}% of CHE${sourceSuffix}<extra></extra>`,
    };
  });

  if (overlay) {
    const sourceSuffix = overlay.source
      ? `  <span style="color:#9ca3af">· ${overlay.source}</span>`
      : "";
    const unitLabel = overlay.unit ?? "USD";
    traces.push({
      x: overlay.data.map((d) => d.year),
      y: overlay.data.map((d) => d.value),
      name: overlay.name,
      type: "scatter" as const,
      mode: "lines" as const,
      yaxis: "y2",
      stackgroup: undefined as unknown as string,
      fillcolor: "transparent",
      line: { color: "#6366f1", width: 2, dash: "dot" as const },
      hovertemplate: `<b>${overlay.name}</b>: $%{y:,.0f} ${unitLabel}${sourceSuffix}<extra></extra>`,
    });
  }

  return (
    <PlotlyChart
      className={className}
      data={traces}
      layout={{
        yaxis: {
          title: { text: yAxisTitle },
          range: [0, 102],
          ticksuffix: "%",
          dtick: 20,
        },
        ...(overlay
          ? {
              yaxis2: {
                title: { text: "USD per capita" },
                overlaying: "y",
                side: "right",
                gridcolor: "transparent",
                tickprefix: "$",
                showgrid: false,
              },
            }
          : {}),
        hovermode: "x unified" as const,
        margin: { l: 64, r: overlay ? 64 : 24, t: 24, b: 40 },
      }}
    />
  );
}
