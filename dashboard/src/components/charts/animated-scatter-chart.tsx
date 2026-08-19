"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Data, Frame, Layout } from "plotly.js-dist-min";
import { PlotlyChart } from "./plotly-chart";
import { INCOME_GROUP_COLORS, INCOME_GROUP_ORDER } from "./chart-config";
import { NoData } from "@/components/ui/no-data";
import type { AnimatedScatterPoint } from "@/lib/types";

interface AnimatedScatterChartProps {
  data: AnimatedScatterPoint[];
  highlightIso3?: string;
  xLabel?: string;
  yLabel?: string;
  xLog?: boolean;
  benchmarkY?: { value: number; label: string };
  className?: string;
}

// Import canonical order from chart-config; keep local alias for use in buildTracesForYear

/**
 * Plotly rejects an animation's promise, with no reason at all, whenever that
 * animation is interrupted — which is what Pause does, and what pressing Play a
 * second time does. Driving the animation from Plotly's own updatemenu buttons
 * meant that promise was created inside Plotly with nothing to catch it, so the
 * rejection escaped and Next reported it as "Runtime Error: undefined".
 *
 * A listener cannot fix that after the fact: Next registers its own
 * unhandledrejection handler at startup and reports first. So the controls live
 * here instead — we create the promise, we catch it.
 */
function plotly() {
  return (
    window as unknown as {
      Plotly?: {
        animate: (
          gd: HTMLElement,
          frames: string[] | null | (string | null)[],
          opts: Record<string, unknown>
        ) => Promise<unknown>;
      };
    }
  ).Plotly;
}

export function AnimatedScatterChart({
  data,
  highlightIso3,
  xLabel = "CHE per capita (USD)",
  yLabel = "Outcome",
  xLog = true,
  benchmarkY,
  className,
}: AnimatedScatterChartProps) {
  const gdRef = useRef<HTMLElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const handleInitialized = useCallback((_figure: unknown, graphDiv: unknown) => {
    gdRef.current = graphDiv as HTMLElement;
  }, []);

  const play = useCallback(() => {
    const gd = gdRef.current;
    if (!gd) return;

    // Animate an explicit list of frame names. Passing `null` — Plotly's
    // "play every frame" form — never settles here and nothing moves; naming
    // the frames works. Resume after the frame currently shown, and start over
    // if we are sitting on the last one.
    const names = (
      (gd as unknown as { _transitionData?: { _frames?: Array<{ name: string }> } })
        ._transitionData?._frames ?? []
    ).map((f) => f.name);
    if (names.length === 0) return;
    const current = (
      gd as unknown as { _fullLayout?: { _currentFrame?: string | null } }
    )._fullLayout?._currentFrame;
    const at = current == null ? -1 : names.indexOf(String(current));
    const queue = at >= 0 && at < names.length - 1 ? names.slice(at + 1) : names;

    setPlaying(true);
    plotly()
      ?.animate(gd, queue, {
        // Scatter frames only move markers; a redraw per frame made it crawl.
        frame: { duration: 650, redraw: false },
        transition: { duration: 400, easing: "cubic-in-out" },
      })
      .then(() => setPlaying(false))
      // Interrupted by Pause or by scrubbing the slider — expected, not an error.
      .catch(() => setPlaying(false));
  }, []);

  const pause = useCallback(() => {
    const gd = gdRef.current;
    if (!gd) return;
    setPlaying(false);
    plotly()
      ?.animate(gd, [null], {
        mode: "immediate",
        frame: { duration: 0, redraw: false },
        transition: { duration: 0 },
      })
      .catch(() => {});
  }, []);

  const { frames, initialTraces, years, xRange, yRange } = useMemo(() => {
    if (data.length === 0) {
      return {
        frames: [] as Frame[],
        initialTraces: [] as Data[],
        years: [] as number[],
        xRange: [1, 10000] as [number, number],
        yRange: [0, 100] as [number, number],
      };
    }

    // Stable axis ranges across the whole animation so countries don't jump frames
    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xRange: [number, number] = xLog
      ? [Math.log10(Math.max(1, xMin * 0.8)), Math.log10(xMax * 1.2)]
      : [xMin * 0.95, xMax * 1.05];
    const yPad = (yMax - yMin) * 0.08 || 1;
    const yRange: [number, number] = [yMin - yPad, yMax + yPad];

    const years = Array.from(new Set(data.map((d) => d.year))).sort(
      (a, b) => a - b
    );

    // One trace per income group per frame — stable ordering for consistent colors/legend
    const buildTracesForYear = (year: number): Data[] => {
      const yearPoints = data.filter((d) => d.year === year);
      return INCOME_GROUP_ORDER.map((group) => {
        const pts = yearPoints.filter(
          (p) => (p.income_group || "Not classified") === group
        );
        return {
          x: pts.map((p) => p.x),
          y: pts.map((p) => p.y),
          text: pts.map((p) => p.country_name),
          customdata: pts.map((p) => p.iso3),
          type: "scatter" as const,
          mode: "markers" as const,
          name: group,
          marker: {
            color: INCOME_GROUP_COLORS[group] || "#9ca3af",
            size: pts.map((p) => (p.iso3 === highlightIso3 ? 16 : 8)),
            opacity: pts.map((p) => (p.iso3 === highlightIso3 ? 1 : 0.55)),
            line: {
              color: pts.map((p) =>
                p.iso3 === highlightIso3 ? "#111827" : "transparent"
              ),
              width: pts.map((p) => (p.iso3 === highlightIso3 ? 2 : 0)),
            },
          },
          hovertemplate:
            "<b>%{text}</b><br>" +
            `${xLabel}: $%{x:,.0f}<br>` +
            `${yLabel}: %{y:.1f}<br>` +
            "<extra>%{fullData.name}</extra>",
        };
      });
    };

    // `traces` maps this frame's data onto the plot's traces by index. Plotly's
    // TS type marks it required, and filling it with [] to satisfy the compiler
    // means "apply this data to no traces" — the animation then has nothing to
    // update, Plotly's animate promise never settles, and pressing Play again
    // stacks a second animation onto the stalled one and throws.
    const traceIndices = INCOME_GROUP_ORDER.map((_, i) => i);
    const frames: Frame[] = years.map((year) => ({
      name: String(year),
      data: buildTracesForYear(year),
      group: "",
      traces: traceIndices,
      baseframe: "",
      layout: {},
    }));

    const initialTraces = buildTracesForYear(years[0]);

    return { frames, initialTraces, years, xRange, yRange };
  }, [data, highlightIso3, xLabel, yLabel, xLog]);

  const layout = useMemo<Partial<Layout>>(() => {
    const sliderSteps = years.map((y) => ({
      label: String(y),
      method: "animate" as const,
      args: [
        [String(y)],
        {
          mode: "immediate",
          frame: { duration: 0, redraw: true },
          transition: { duration: 400, easing: "cubic-in-out" },
        },
      ],
    }));

    return {
      xaxis: {
        title: { text: xLabel },
        type: xLog ? "log" : "linear",
        tickprefix: "$",
        range: xRange,
        autorange: false,
      },
      yaxis: {
        title: { text: yLabel },
        range: yRange,
        autorange: false,
      },
      hovermode: "closest" as const,
      transition: { duration: 400, easing: "cubic-in-out" },
      sliders: [
        {
          active: 0,
          x: 0,
          xanchor: "left",
          y: -0.15,
          yanchor: "top",
          len: 1,
          currentvalue: {
            prefix: "Year: ",
            font: { size: 13, color: "#111827" },
            xanchor: "left",
          },
          pad: { t: 4, b: 4 },
          bgcolor: "#e5e7eb",
          activebgcolor: "#2563eb",
          bordercolor: "transparent",
          tickcolor: "#9ca3af",
          font: { size: 10, color: "#6b7280" },
          transition: { duration: 400, easing: "cubic-in-out" },
          steps: sliderSteps,
        },
      ],
      margin: { l: 56, r: 24, t: 24, b: 80 },
      shapes: benchmarkY
        ? [
            {
              type: "line",
              x0: 0,
              x1: 1,
              xref: "paper",
              y0: benchmarkY.value,
              y1: benchmarkY.value,
              yref: "y",
              line: { color: "#9ca3af", width: 1.5, dash: "dash" },
            },
          ]
        : undefined,
      annotations: benchmarkY
        ? [
            {
              x: 1,
              xref: "paper",
              y: benchmarkY.value,
              yref: "y",
              text: benchmarkY.label,
              showarrow: false,
              xanchor: "right",
              yanchor: "bottom",
              font: { size: 11, color: "#6b7280" },
            },
          ]
        : undefined,
    };
  }, [years, xRange, yRange, xLabel, yLabel, xLog, benchmarkY]);

  // react-plotly.js re-syncs the whole plot (Plotly.react) on every parent
  // render, and doing that mid-animation restarts the frame queue — which is
  // why pressing Pause appeared to do nothing: the state update that flipped
  // the button label immediately re-rendered the chart and set it going again.
  // Holding the element in a memo means toggling `playing` no longer touches
  // the chart subtree at all.
  const chart = useMemo(
    () => (
      <PlotlyChart
        className="min-h-0 flex-1"
        data={initialTraces}
        frames={frames}
        layout={layout}
        onInitialized={handleInitialized}
      />
    ),
    [initialTraces, frames, layout, handleInitialized]
  );

  if (data.length === 0) {
    return (
      <div className={className}>
        <NoData
          variant="chart"
          label="year-over-year scatter data"
          hint="Not enough country-years are available to animate this view."
        />
      </div>
    );
  }

  return (
    <div className={className ? `${className} flex flex-col` : "flex flex-col"}>
      <div className="mb-1 flex items-center gap-2">
        <button
          type="button"
          onClick={playing ? pause : play}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <span className="text-xs tabular-nums text-muted-foreground/70">
          {years[0]}–{years[years.length - 1]}
        </span>
      </div>
      {chart}
    </div>
  );
}
