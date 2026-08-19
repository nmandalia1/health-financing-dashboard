"use client";

import { PlotlyChart } from "./plotly-chart";

interface RadarChartProps {
  /** Label-value pairs for each arm */
  arms: { label: string; value: number }[];
  /** Optional peer group overlay */
  peerArms?: { label: string; value: number }[];
  countryName?: string;
  className?: string;
}

export function RadarChart({
  arms,
  peerArms,
  countryName = "Country",
  className,
}: RadarChartProps) {
  const labels = arms.map((a) => a.label);
  const values = arms.map((a) => a.value);

  const traces = [
    {
      type: "scatterpolar" as const,
      r: [...values, values[0]], // close the polygon
      theta: [...labels, labels[0]],
      fill: "toself" as const,
      fillcolor: "rgba(37, 99, 235, 0.15)",
      line: { color: "#2563eb", width: 2 },
      name: countryName,
      hovertemplate: "%{theta}: %{r:.0f} / 100<extra></extra>",
    },
  ];

  if (peerArms) {
    const peerValues = peerArms.map((a) => a.value);
    traces.push({
      type: "scatterpolar" as const,
      r: [...peerValues, peerValues[0]],
      theta: [...labels, labels[0]],
      fill: "toself" as const,
      fillcolor: "rgba(107, 114, 128, 0.1)",
      line: { color: "#9ca3af", width: 1.5, dash: "dot" } as typeof traces[0]["line"],
      name: "Peer average",
      hovertemplate: "%{theta}: %{r:.0f} / 100<extra></extra>",
    });
  }

  return (
    <PlotlyChart
      className={className}
      data={traces}
      layout={{
        polar: {
          radialaxis: {
            visible: true,
            range: [0, 100],
            tickvals: [0, 25, 50, 75, 100],
            ticksuffix: "",
            gridcolor: "#e5e7eb",
            title: { text: "Score (0–100)", font: { size: 10, color: "#9ca3af" } },
          },
          angularaxis: {
            gridcolor: "#e5e7eb",
          },
        },
        showlegend: true,
      }}
    />
  );
}
