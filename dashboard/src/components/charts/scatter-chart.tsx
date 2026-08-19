"use client";

import type { Data } from "plotly.js-dist-min";
import { PlotlyChart } from "./plotly-chart";
import { INCOME_GROUP_COLORS, INCOME_GROUP_ORDER } from "./chart-config";
import { NoData } from "@/components/ui/no-data";
import type { ScatterPoint } from "@/lib/types";

interface ScatterChartProps {
  data: ScatterPoint[];
  highlightIso3?: string;
  xLabel?: string;
  yLabel?: string;
  xLog?: boolean;
  /** Horizontal benchmark line */
  benchmarkY?: { value: number; label: string };
  className?: string;
}

export function ScatterChart({
  data,
  highlightIso3,
  xLabel = "CHE per capita (USD)",
  yLabel = "Life expectancy",
  xLog = true,
  benchmarkY,
  className,
}: ScatterChartProps) {
  if (data.length === 0) {
    return (
      <div className={className}>
        <NoData variant="chart" label="scatter data" />
      </div>
    );
  }

  // Group by income group, using canonical order for consistent legend
  const groupMap = data.reduce<Record<string, ScatterPoint[]>>((acc, pt) => {
    const group = pt.income_group || "Not classified";
    if (!acc[group]) acc[group] = [];
    acc[group].push(pt);
    return acc;
  }, {});
  const groups = INCOME_GROUP_ORDER
    .filter((g) => groupMap[g])
    .map((g) => [g, groupMap[g]] as [string, ScatterPoint[]]);

  const traces: Data[] = groups.map(([group, points]) => ({
    x: points.map((p) => p.x),
    y: points.map((p) => p.y),
    text: points.map((p) => p.country_name),
    customdata: points.map((p) => p.iso3),
    type: "scatter" as const,
    mode: "markers" as const,
    name: group,
    marker: {
      color: INCOME_GROUP_COLORS[group] || "#9ca3af",
      size: points.map((p) =>
        p.iso3 === highlightIso3 ? 14 : 7
      ),
      opacity: points.map((p) =>
        p.iso3 === highlightIso3 ? 1 : 0.6
      ),
      line: {
        color: points.map((p) =>
          p.iso3 === highlightIso3 ? "#111827" : "transparent"
        ),
        width: points.map((p) => (p.iso3 === highlightIso3 ? 2 : 0)),
      },
    },
    hovertemplate:
      "<b>%{text}</b><br>" +
      `${xLabel}: $%{x:,.0f}<br>` +
      `${yLabel}: %{y:.1f}<br>` +
      "<extra>%{fullData.name}</extra>",
  }));

  // Add benchmark line
  if (benchmarkY) {
    traces.push({
      x: [
        Math.min(...data.map((d) => d.x)),
        Math.max(...data.map((d) => d.x)),
      ],
      y: [benchmarkY.value, benchmarkY.value],
      text: [benchmarkY.label, ""],
      customdata: ["", ""],
      type: "scatter" as const,
      mode: "lines" as const,
      name: benchmarkY.label,
      line: { color: "#9ca3af", width: 1.5, dash: "dash" as const },
      marker: { color: "#9ca3af", size: 0, opacity: 0, line: { color: "transparent", width: 0 } },
      hovertemplate: `${benchmarkY.label}: ${benchmarkY.value}<extra></extra>`,
    });
  }

  return (
    <PlotlyChart
      className={className}
      data={traces}
      layout={{
        xaxis: {
          title: { text: xLabel },
          type: xLog ? "log" : "linear",
          tickprefix: "$",
        },
        yaxis: { title: { text: yLabel } },
        hovermode: "closest" as const,
      }}
    />
  );
}
