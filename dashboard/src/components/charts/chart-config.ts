import type { Layout, Config } from "plotly.js-dist-min";

/** Consistent financing source colors across all views (PRD Appendix B) */
export const FINANCING_COLORS = {
  govt: "#2563eb",
  oop: "#d97706",
  external: "#0d9488",
  private: "#6b7280",
  total: "#111827",
} as const;

/** Income group colors for scatter plots — ordered from low to high income */
export const INCOME_GROUP_COLORS: Record<string, string> = {
  "Low income": "#dc2626",          // red
  "Lower middle income": "#d97706", // amber — distinct from red
  "Upper middle income": "#2563eb", // blue
  "High income": "#059669",         // emerald
  "Not classified": "#9ca3af",      // grey
};

/**
 * Light-mode series colours that vanish on the dark card, mapped to a lighter
 * twin of the same hue. `#111827` ("total") sits at 1.08:1 against the dark
 * card — effectively invisible — and several antigen lines are barely better.
 *
 * The dark twins for the financing sources are the ones already declared in
 * globals.css (--color-*-dark); the rest keep their hue and gain lightness so
 * series stay distinguishable from each other in both themes.
 *
 * Applied by PlotlyChart at render time, so every chart is covered rather than
 * whichever call sites got remembered. Colour SCALES are deliberately left
 * alone — remapping individual stops would break the gradient.
 */
export const DARK_SERIES_COLORS: Record<string, string> = {
  "#111827": "#f9fafb", // total — invisible on dark
  "#2563eb": "#60a5fa", // govt
  "#d97706": "#fbbf24", // oop
  "#0d9488": "#2dd4bf", // external
  "#6b7280": "#9ca3af", // private
  "#1e3a8a": "#93c5fd", // HepB birth-dose
  "#334155": "#cbd5e1", // IPV1
  "#14532d": "#4ade80", // BCG
  // Polio3 — deliberately off-grey: the light-mode greys all land in the
  // same band on dark, and #9ca3af is the reference-line colour.
  "#4b5563": "#22d3ee",
  "#1d4ed8": "#60a5fa",
  "#b91c1c": "#f87171",
  "#be185d": "#f472b6",
  "#7c3aed": "#a78bfa",
  "#059669": "#34d399",
  "#dc2626": "#f87171",
};

/** Ordered income groups for consistent legend rendering */
export const INCOME_GROUP_ORDER = [
  "Low income",
  "Lower middle income",
  "Upper middle income",
  "High income",
  "Not classified",
] as const;

/** Shared Plotly layout defaults */
export const BASE_LAYOUT: Partial<Layout> = {
  font: { family: "Inter, system-ui, sans-serif", size: 12, color: "#374151" },
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  margin: { l: 56, r: 24, t: 24, b: 40 },
  xaxis: {
    gridcolor: "#f3f4f6",
    linecolor: "#e5e7eb",
    zeroline: false,
  },
  yaxis: {
    gridcolor: "#f3f4f6",
    linecolor: "#e5e7eb",
    zeroline: false,
  },
  hoverlabel: {
    bgcolor: "#ffffff",
    bordercolor: "#e5e7eb",
    font: { family: "Inter, system-ui, sans-serif", size: 12, color: "#111827" },
  },
  legend: {
    orientation: "h",
    yanchor: "bottom",
    y: 1.02,
    xanchor: "left",
    x: 0,
    font: { size: 11 },
  },
  autosize: true,
};

/** Shared Plotly config */
export const BASE_CONFIG: Partial<Config> = {
  responsive: true,
  // Show a minimal modebar on hover with PNG/SVG download only.
  displayModeBar: "hover",
  displaylogo: false,
  modeBarButtonsToRemove: [
    "zoom2d",
    "pan2d",
    "select2d",
    "lasso2d",
    "zoomIn2d",
    "zoomOut2d",
    "autoScale2d",
    "resetScale2d",
    "hoverClosestCartesian",
    "hoverCompareCartesian",
    "toggleSpikelines",
    "zoomInGeo",
    "zoomOutGeo",
    "resetGeo",
    "hoverClosestGeo",
  ],
  toImageButtonOptions: {
    format: "png",
    filename: "health-financing-chart",
    height: 720,
    width: 1280,
    scale: 2,
  },
};
