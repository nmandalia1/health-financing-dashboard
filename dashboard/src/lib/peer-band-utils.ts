/**
 * Utilities for rendering income-group peer percentile bands in Plotly charts.
 *
 * Usage pattern (two-trace approach):
 *   1. Invisible P25 baseline trace — establishes lower bound for "tonexty" fill.
 *   2. P75 trace filled down to P25 — creates the shaded band.
 *
 * Prepend these traces to your chart's `data` array so the band sits
 * behind the primary country lines.
 */

import type { Data } from "plotly.js-dist-min";
import type { PercentileBand } from "./types";

/** Hex color → rgba string with given alpha (0–1). */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface BandTraceOptions {
  /** Income-group label shown in legend and hover */
  incomeGroup: string;
  /** Colour for the band lines and fill (hex). Defaults to a neutral grey. */
  color?: string;
  /** Plotly y-axis to bind to (e.g. "y2"). Defaults to "y". */
  yaxis?: string;
}

/**
 * Returns two Plotly Data traces that render a P25–P75 shaded band.
 * Prepend these to your `data` array so they appear behind main lines.
 */
export function makeBandTraces(
  data: PercentileBand[],
  options: BandTraceOptions
): Data[] {
  if (!data || data.length === 0) return [];

  const { incomeGroup, color = "#9ca3af", yaxis = "y" } = options;
  const years = data.map((d) => d.year);
  const p25s = data.map((d) => d.p25);
  const p75s = data.map((d) => d.p75);
  const p50s = data.map((d) => d.p50);

  // Build hover text for p75 trace
  const customdata = data.map((d) => [d.p25, d.p50, d.n]);
  const hovertemplate =
    `<b>${incomeGroup} (income group peers)</b><br>` +
    `P75: %{y:.1f}<br>` +
    `Median: %{customdata[1]:.1f}<br>` +
    `P25: %{customdata[0]:.1f}<br>` +
    `Countries: %{customdata[2]}` +
    `<extra></extra>`;

  return [
    // ── Trace 1: P25 invisible baseline (needed for tonexty fill) ──────────
    {
      type: "scatter",
      mode: "lines",
      x: years,
      y: p25s,
      yaxis,
      name: `${incomeGroup} P25`,
      line: { width: 0, color },
      showlegend: false,
      hoverinfo: "skip",
    } as Data,

    // ── Trace 2: P75 filled to P25 (the visible band) ──────────────────────
    {
      type: "scatter",
      mode: "lines",
      x: years,
      y: p75s,
      yaxis,
      name: `${incomeGroup} P25–P75`,
      fill: "tonexty",
      fillcolor: hexToRgba(color, 0.12),
      line: { width: 0.5, color, dash: "dot" },
      customdata,
      hovertemplate,
      legendgroup: "peer-band",
    } as Data,

    // ── Trace 3: P50 median (thin dashed) ──────────────────────────────────
    {
      type: "scatter",
      mode: "lines",
      x: years,
      y: p50s,
      yaxis,
      name: `${incomeGroup} median`,
      line: { width: 1.5, color, dash: "dash" },
      hoverinfo: "skip",
      legendgroup: "peer-band",
      showlegend: false,
    } as Data,
  ];
}
