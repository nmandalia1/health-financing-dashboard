"use client";

import { useMemo, useRef } from "react";
import type { Data, Layout, PlotMouseEvent } from "plotly.js-dist-min";
import { PlotlyChart } from "./plotly-chart";
import { useDarkMode } from "@/hooks/use-dark-mode";
import type { ChoroplethPoint } from "@/lib/types";

/** A country the current indicator has no value for. */
export interface NoDataCountry {
  iso3: string;
  country_name: string;
}

interface ChoroplethMapProps {
  data: ChoroplethPoint[];
  unit: string;
  colorscale?: string | Array<[number, string]>;
  reverseScale?: boolean;
  onSelect?: (iso3: string) => void;
  height?: number;
  /**
   * Countries the indicator has no value for. Drawn as a second, flat trace so
   * they are still hoverable and clickable — left out of the figure entirely
   * they are silently inert, which reads as the map being broken.
   */
  noData?: NoDataCountry[];
}

export function ChoroplethMap({
  data,
  unit,
  colorscale = "Blues",
  reverseScale = false,
  onSelect,
  height = 520,
  noData = [],
}: ChoroplethMapProps) {
  const isDark = useDarkMode();

  const traces = useMemo<Data[]>(() => {
    const locations = data.map((d) => d.iso3);
    const values = data.map((d) => d.value);
    const text = data.map(
      (d) =>
        `<b>${d.country_name}</b><br>${formatValue(d.value, unit)}<br><span style="color:#6b7280">${
          d.income_group || "—"
        } · ${d.year}</span>`
    );
    const blank = isDark ? "#2b3038" : "#e8eaee";
    const noDataTrace = {
      type: "choropleth",
      locations: noData.map((c) => c.iso3),
      z: noData.map(() => 0),
      locationmode: "ISO-3",
      text: noData.map(
        (c) =>
          `<b>${c.country_name}</b><br><span style="color:#9ca3af">No data for this indicator</span>`
      ),
      hovertemplate: "%{text}<extra></extra>",
      colorscale: [
        [0, blank],
        [1, blank],
      ],
      showscale: false,
      marker: { line: { color: "#ffffff", width: 0.6 } },
    } as unknown as Data;

    return [
      ...(noData.length ? [noDataTrace] : []),
      {
        type: "choropleth",
        locations,
        z: values,
        locationmode: "ISO-3",
        text,
        hovertemplate: "%{text}<extra></extra>",
        colorscale,
        reversescale: reverseScale,
        marker: { line: { color: "#ffffff", width: 0.6 } },
        colorbar: {
          thickness: 8,
          len: 0.55,
          y: 0.5,
          x: 0.98,
          xpad: 0,
          ypad: 0,
          tickfont: {
            size: 10,
            color: "#6b7280",
            family: "Inter, system-ui, sans-serif",
          },
          outlinewidth: 0,
          bgcolor: "rgba(255,255,255,0.75)",
          bordercolor: "rgba(0,0,0,0)",
        },
      } as unknown as Data,
    ];
  }, [data, unit, colorscale, reverseScale, noData, isDark]);

  const layout = useMemo<Partial<Layout>>(
    () => ({
      margin: { l: 0, r: 0, t: 0, b: 0 },
      geo: {
        showframe: false,
        showcoastlines: false,
        showcountries: true,
        countrycolor: "#e5e7eb",
        showland: true,
        landcolor: "#f9fafb",
        showocean: false,
        bgcolor: "rgba(0,0,0,0)",
        projection: { type: "natural earth" },
        lataxis: { range: [-58, 85] },
      },
      dragmode: false,
      hoverlabel: {
        bgcolor: "#ffffff",
        bordercolor: "#e5e7eb",
        font: {
          family: "Inter, system-ui, sans-serif",
          size: 12,
          color: "#111827",
        },
      },
    }),
    []
  );

  // Clicking a country did nothing because Plotly never emits `plotly_click`
  // for this geo subplot — the handler attaches, it just never fires. Hover
  // does work (it is what draws the tooltip), so track the country under the
  // pointer and navigate on a real DOM click.
  //
  // The click has to be taken in the CAPTURE phase: Plotly calls
  // stopPropagation() on it, so it never bubbles up to React's root listener
  // and a plain onClick is never called.
  const hovered = useRef<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const setHovered = (iso3: string | null) => {
    hovered.current = iso3;
    // Set directly rather than through state: hover fires continuously as the
    // pointer crosses the map, and none of it should re-render the chart.
    if (wrap.current) wrap.current.style.cursor = iso3 ? "pointer" : "";
  };

  return (
    <div
      ref={wrap}
      onClickCapture={() => {
        if (hovered.current) onSelect?.(hovered.current);
      }}
    >
      <PlotlyChart
        data={traces}
        layout={layout}
        className="w-full"
        style={{ width: "100%", height }}
        onHover={(evt: Readonly<PlotMouseEvent>) =>
          setHovered(
            (evt.points?.[0] as { location?: string } | undefined)?.location ??
              null
          )
        }
        onUnhover={() => setHovered(null)}
      />
    </div>
  );
}

function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${unit}`;
}
