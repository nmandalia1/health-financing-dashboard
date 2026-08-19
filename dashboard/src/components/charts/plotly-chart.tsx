"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { PlotParams } from "react-plotly.js";
import { BASE_CONFIG, BASE_LAYOUT, DARK_SERIES_COLORS } from "./chart-config";
import { useDarkMode } from "@/hooks/use-dark-mode";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[300px] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
    </div>
  ),
});

/**
 * Swap a series colour for its dark-mode twin, preserving any alpha suffix
 * (fills are written as `${color}55`). Unknown colours pass through untouched.
 */
function darkSeriesColor(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const m = /^(#[0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(value.trim());
  if (!m) return value;
  const swapped = DARK_SERIES_COLORS[m[1].toLowerCase()];
  return swapped ? `${swapped}${m[2] ?? ""}` : value;
}

/** Colour can be one value or one per point. */
function mapColor(value: unknown): unknown {
  return Array.isArray(value) ? value.map(darkSeriesColor) : darkSeriesColor(value);
}

/**
 * Re-colour a trace for dark mode. Charts declare their series in light-mode
 * colours; several of those are invisible against the dark card, so the swap
 * happens here rather than in every chart that ever gets written.
 */
function themeTrace(trace: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...trace };
  if (out.fillcolor !== undefined) out.fillcolor = mapColor(out.fillcolor);

  const line = out.line as Record<string, unknown> | undefined;
  if (line?.color !== undefined) out.line = { ...line, color: mapColor(line.color) };

  const marker = out.marker as Record<string, unknown> | undefined;
  if (marker) {
    const next: Record<string, unknown> = { ...marker };
    if (next.color !== undefined) next.color = mapColor(next.color);
    const ml = next.line as Record<string, unknown> | undefined;
    if (ml?.color !== undefined) next.line = { ...ml, color: mapColor(ml.color) };
    out.marker = next;
  }
  return out;
}

interface PlotlyChartProps extends Omit<PlotParams, "config"> {
  className?: string;
  config?: Partial<PlotParams["config"]>;
}

export function PlotlyChart({
  data,
  layout,
  config,
  className,
  ...rest
}: PlotlyChartProps) {
  const isDark = useDarkMode();

  const themedData = useMemo(
    () =>
      isDark
        ? (data as unknown as Record<string, unknown>[]).map(themeTrace)
        : data,
    [data, isDark]
  );


  const fontColor = isDark ? "#d1d5db" : "#374151";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#f3f4f6";
  const lineColor = isDark ? "rgba(255,255,255,0.12)" : "#e5e7eb";
  const hoverBg = isDark ? "#1f2937" : "#ffffff";
  const hoverBorder = isDark ? "#374151" : "#e5e7eb";
  const hoverFont = isDark ? "#f9fafb" : "#111827";

  const themeLayout = {
    font: { ...BASE_LAYOUT.font, color: fontColor },
    xaxis: {
      gridcolor: gridColor,
      linecolor: lineColor,
      zeroline: false,
    },
    yaxis: {
      gridcolor: gridColor,
      linecolor: lineColor,
      zeroline: false,
    },
    hoverlabel: {
      bgcolor: hoverBg,
      bordercolor: hoverBorder,
      font: { family: "Inter, system-ui, sans-serif", size: 12, color: hoverFont },
    },
  };

  return (
    <div className={className}>
      <Plot
        data={themedData as PlotParams["data"]}
        layout={{
          ...BASE_LAYOUT,
          ...themeLayout,
          ...layout,
          font: { ...BASE_LAYOUT.font, ...themeLayout.font, ...layout?.font },
          xaxis: { ...themeLayout.xaxis, ...layout?.xaxis },
          yaxis: { ...themeLayout.yaxis, ...layout?.yaxis },
          hoverlabel: { ...themeLayout.hoverlabel, ...layout?.hoverlabel },
        }}
        config={{ ...BASE_CONFIG, ...config }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        {...rest}
      />
    </div>
  );
}
