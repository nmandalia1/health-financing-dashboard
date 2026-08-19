"use client";

import { PlotlyChart } from "./plotly-chart";
import { NoData } from "@/components/ui/no-data";
import type { IndicatorTimeSeries } from "@/lib/types";

interface SparklineProps {
  data: IndicatorTimeSeries[];
  color?: string;
  label?: string;
  /**
   * Full Plotly Y-value format expression used in hover.
   * Defaults to "%{y:,.0f}".
   * Examples: "$%{y:,.0f}", "%{y:.1f}%"
   */
  hoverValue?: string;
  className?: string;
}

export function Sparkline({
  data,
  color = "#6b7280",
  label,
  hoverValue,
  className,
}: SparklineProps) {
  if (data.length === 0) {
    return (
      <div className={className}>
        <NoData variant="chart" label={label ?? "trend data"} />
      </div>
    );
  }

  return (
    <PlotlyChart
      className={className}
      data={[
        {
          x: data.map((d) => d.year),
          y: data.map((d) => d.value),
          type: "scatter" as const,
          mode: "lines" as const,
          fill: "tozeroy",
          fillcolor: `${color}15`,
          line: { color, width: 1.5 },
          hovertemplate: `%{x}: ${hoverValue ?? "%{y:,.0f}"}<extra></extra>`,
        },
      ]}
      layout={{
        margin: { l: 4, r: 4, t: label ? 20 : 4, b: 4 },
        xaxis: {
          visible: false,
          gridcolor: "transparent",
          linecolor: "transparent",
        },
        yaxis: {
          visible: false,
          gridcolor: "transparent",
          linecolor: "transparent",
        },
        showlegend: false,
        ...(label
          ? {
              annotations: [
                {
                  text: label,
                  xref: "paper",
                  yref: "paper",
                  x: 0,
                  y: 1.15,
                  showarrow: false,
                  font: { size: 11, color: "#6b7280" },
                },
              ],
            }
          : {}),
        hovermode: "x" as const,
      }}
    />
  );
}
