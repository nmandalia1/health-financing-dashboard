"use client";

import type { ReactNode } from "react";
import {
  bandColor,
  benchmarkLabel,
  benchmarkStatus,
  formatMetricValue,
  unitSuffix,
} from "@/lib/fiscal-scoring";
import type { IndicatorTimeSeries } from "@/lib/types";

export interface MetricHoverData {
  label: string;
  source?: string;
  unit?: string;
  /** Time series for the inline sparkline + latest value. */
  series?: IndicatorTimeSeries[];
  /** Peer-normalised 0–100 score (e.g. a component's contribution). */
  score?: number | null;
  /** +1 higher-is-better, −1 lower-is-better, 0 neutral. */
  direction?: number;
  benchmarks?: Record<string, number>;
  interpretation?: string;
  /** Override the value drawn from the series (e.g. for composites). */
  valueOverride?: string;
}

interface MetricHoverCardProps extends MetricHoverData {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  /** Anchor id, so the navigator's indicator lane can deep-link here. */
  id?: string;
}

/** Lightweight inline SVG sparkline — instant on hover, no chart lib. */
function MiniSpark({ series, color }: { series: IndicatorTimeSeries[]; color: string }) {
  if (series.length < 2) return null;
  const ys = series.map((d) => d.value);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const n = series.length;
  const pts = series
    .map((d, i) => {
      const x = (i / (n - 1)) * 100;
      const y = 28 - ((d.value - lo) / span) * 26 - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = pts.split(" ").slice(-1)[0].split(",");
  return (
    <svg viewBox="0 0 100 30" width="100%" height="30" preserveAspectRatio="none"
         className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
                vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill={color} />
    </svg>
  );
}

export function MetricHoverCard({
  children,
  label,
  source,
  unit = "",
  series = [],
  score,
  direction = 0,
  benchmarks,
  interpretation,
  valueOverride,
  align = "left",
  className,
  id,
}: MetricHoverCardProps) {
  const latest = series.length ? series[series.length - 1] : null;
  const valueText =
    valueOverride ?? (latest ? formatMetricValue(latest.value, unit) : "—");
  const suffix = unitSuffix(unit);
  const yearSpan =
    series.length > 1 ? `${series[0].year}–${series[series.length - 1].year}` : null;
  const dirText =
    direction > 0 ? "higher is better" : direction < 0 ? "lower is better" : "context";
  const benchEntries = benchmarks ? Object.entries(benchmarks) : [];

  return (
    <span id={id} className={`group relative scroll-mt-6 rounded-md ${className ?? "inline-flex"}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-50 mt-2 w-72 origin-top scale-95 rounded-lg border bg-popover p-3 text-left opacity-0 shadow-lg transition-all duration-100 group-hover:scale-100 group-hover:opacity-100 ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        <span className="mb-1 flex items-start justify-between gap-2">
          <span className="text-[13px] font-medium leading-tight text-foreground">{label}</span>
          {source && (
            <span className="shrink-0 text-[10px] text-muted-foreground/70">{source}</span>
          )}
        </span>

        <span className="flex items-baseline gap-1.5">
          <span className="text-xl font-medium tabular-nums">{valueText}</span>
          {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
          {latest && (
            <span className="ml-auto text-[10px] text-muted-foreground/70">{latest.year}</span>
          )}
        </span>

        {series.length > 1 && (
          <span className="mt-1.5 block">
            <MiniSpark series={series} color={bandColor(score ?? 50)} />
            <span className="mt-0.5 flex justify-between text-[10px] text-muted-foreground/60">
              <span>{yearSpan}</span>
              <span>{dirText}</span>
            </span>
          </span>
        )}

        {score != null && (
          <span className="mt-2 block">
            <span className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>scored vs peers</span>
              <span className="font-medium tabular-nums text-foreground">{Math.round(score)}/100</span>
            </span>
            <span className="relative block h-2 w-full rounded-full bg-muted">
              <span className="absolute left-0 top-0 block h-2 rounded-full"
                    style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: bandColor(score) }} />
            </span>
          </span>
        )}

        {benchEntries.length > 0 && latest && (
          <span className="mt-2 flex flex-wrap gap-1">
            {benchEntries.map(([k, v]) => {
              const st = benchmarkStatus(latest.value, v, direction);
              return (
                <span key={k}
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        background: st.met ? "#16a34a18" : "#dc262618",
                        color: st.met ? "#15803d" : "#b91c1c",
                      }}>
                  {benchmarkLabel(k)}: {st.word}
                </span>
              );
            })}
          </span>
        )}

        {interpretation && (
          <span className="mt-2 block border-t pt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {interpretation}
          </span>
        )}
      </span>
    </span>
  );
}
