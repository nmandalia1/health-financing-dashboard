"use client";

import { Compass as CompassFooter } from "@/components/layout/compass";

/**
 * PFM × Health landing — 5-step narrative carousel.
 * Each step has a collapsible "expanded" section with supporting charts/tables.
 *
 * Data is loaded once in useNarrativeData() and shared across all steps.
 * Sub-group statistics (r by income group, r by financing regime, etc.) are
 * computed in JavaScript from the already-loaded scatter points — no extra
 * DuckDB round-trips.
 */

import { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BookOpen,
  TrendingDown,
  Wallet,
  BarChart2,
  Compass,
  ArrowRight,
} from "lucide-react";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { useDuckDB } from "@/lib/duckdb-provider";
import {
  getPfmScatter,
  getPfmCorrelation,
  getPfmLastMileRanking,
  pfmMartsAvailable,
} from "@/lib/pfm-queries";
import {
  PFM_SCORE_OPTIONS,
  PFM_OUTCOME_OPTIONS,
  type PfmScoreCode,
  type PfmOutcomeCode,
  type PfmScatterPoint,
  type PfmLastMileRow,
} from "@/lib/pfm-types";
import {
  INCOME_GROUP_COLORS,
  INCOME_GROUP_ORDER,
} from "@/components/charts/chart-config";
import type { Data, PlotMouseEvent } from "plotly.js-dist-min";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Pearson r computed from [x, y] pairs — avoids extra DuckDB round-trips */
function pearsonR(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0, varX = 0, varY = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx, dy = y - my;
    num += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? null : num / denom;
}

function fmtR(r: number | null): string {
  if (r === null) return "—";
  return (r >= 0 ? "+" : "") + r.toFixed(2);
}

function regimeOf(pct: number | null): string {
  if (pct === null) return "unknown";
  if (pct > 75) return "high (>75%)";
  if (pct >= 50) return "mid (50–75%)";
  return "low (<50%)";
}

const FINANCING_COLORS: Record<string, string> = {
  "high (>75%)":  "#059669",
  "mid (50–75%)": "#2563eb",
  "low (<50%)":   "#dc2626",
  unknown:        "#9ca3af",
};

const STEP_DEFS = [
  { id: "hook",      icon: BookOpen,     label: "The question" },
  { id: "pattern",   icon: TrendingDown, label: "Global pattern" },
  { id: "threshold", icon: Wallet,       label: "Financing threshold" },
  { id: "lastmile",  icon: BarChart2,    label: "Last mile" },
  { id: "explore",   icon: Compass,      label: "Explore" },
] as const;

// ─── trace builders ───────────────────────────────────────────────────────────

function buildIncomeTraces(points: PfmScatterPoint[]): Data[] {
  return INCOME_GROUP_ORDER.map((g) => {
    const pts = points.filter((p) => p.income_group === g);
    return mkTrace(pts, g, INCOME_GROUP_COLORS[g] ?? "#9ca3af");
  }).filter((t) => (t as { x: unknown[] }).x.length > 0);
}

function buildFinancingTraces(points: PfmScatterPoint[]): Data[] {
  return (["high (>75%)", "mid (50–75%)", "low (<50%)", "unknown"] as const).map((r) => {
    const pts = points.filter((p) => regimeOf(p.gghed_pct_che) === r);
    return mkTrace(pts, r, FINANCING_COLORS[r]);
  }).filter((t) => (t as { x: unknown[] }).x.length > 0);
}

function mkTrace(pts: PfmScatterPoint[], name: string, color: string): Data {
  return {
    type: "scatter", mode: "markers", name,
    x: pts.map((p) => p.pfm_score),
    y: pts.map((p) => p.outcome_value),
    text: pts.map((p) => p.iso3),
    customdata: pts.map((p) => [p.country_name, p.income_group, p.pefa_assessment_year ?? p.year, p.gghed_pct_che?.toFixed(1) ?? "n/a"]),
    marker: {
      color, opacity: 0.82,
      size: pts.map((p) => p.gghed_pct_che !== null ? Math.max(6, Math.min(20, p.gghed_pct_che / 5)) : 8),
      line: { width: 0.5, color: "#ffffff" },
    },
    hovertemplate:
      "<b>%{customdata[0]}</b> (%{text})<br>" +
      "PFM: %{x:.2f} · Outcome: %{y:.1f}<br>" +
      "Income: %{customdata[1]} · PEFA: %{customdata[2]}<br>" +
      "GGHE-D/CHE: %{customdata[3]}%<extra></extra>",
  } as Data;
}

const SCATTER_LAYOUT_BASE = {
  xaxis: { title: { text: "PEFA PCBE pillar score (0–4)" }, range: [0, 4.2] as [number, number] },
  yaxis: { title: { text: "Under-5 mortality (per 1,000)" } },
  legend: { orientation: "h" as const, yanchor: "bottom" as const, y: 1.02, xanchor: "left" as const, x: 0 },
};

// ─── data hook ────────────────────────────────────────────────────────────────

function useNarrativeData() {
  const { conn } = useDuckDB();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [points, setPoints]   = useState<PfmScatterPoint[]>([]);
  const [rAll,   setRAll]     = useState<{ r: number | null; n: number }>({ r: null, n: 0 });
  const [rHigh,  setRHigh]    = useState<{ r: number | null; n: number }>({ r: null, n: 0 });
  const [rLow,   setRLow]     = useState<{ r: number | null; n: number }>({ r: null, n: 0 });
  const [lastMile, setLastMile] = useState<PfmLastMileRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const ok = await pfmMartsAvailable(conn);
        if (cancelled) return;
        setAvailable(ok);
        if (!ok) { setLoading(false); return; }
        const [pts, all, high, low, lm] = await Promise.all([
          getPfmScatter(conn, "pillar3", "u5mr"),
          getPfmCorrelation(conn, "pillar3", "u5mr"),
          getPfmCorrelation(conn, "pillar3", "u5mr", { financingRegime: "high" }),
          getPfmCorrelation(conn, "pillar3", "u5mr", { financingRegime: "low" }),
          getPfmLastMileRanking(conn),
        ]);
        if (cancelled) return;
        setPoints(pts); setRAll(all); setRHigh(high); setRLow(low); setLastMile(lm);
      } catch (e) {
        console.error("Narrative data error:", e);
        if (!cancelled) setAvailable(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conn]);

  return { available, points, rAll, rHigh, rLow, lastMile, loading };
}

// ─── shared UI atoms ─────────────────────────────────────────────────────────

function ExpandToggle({
  expanded,
  onToggle,
  label = "More context",
}: {
  expanded: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group mx-auto mt-2 flex items-center gap-1.5 rounded-full border border-dashed bg-transparent px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      {expanded ? "Show less" : label}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm text-muted-foreground">PFM mart not yet generated.</p>
      <p className="text-xs text-muted-foreground">
        Run <code className="rounded bg-muted px-1 py-0.5">python run_pipeline.py</code>
      </p>
    </div>
  );
}

// ─── Step 0 · Hook ────────────────────────────────────────────────────────────

function HookStep({
  n, r, onNext,
}: { n: number; r: number | null; onNext: () => void }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="flex flex-col justify-center gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">The question</p>
          <h2 className="mt-2 text-2xl font-bold leading-tight tracking-tight md:text-3xl">
            Does public budget<br />management shape<br />child survival?
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Public Financial Management (PFM) determines whether health budgets are
          credible, reach front-line facilities, and are spent as intended. It
          is strongly associated with health system performance in recent evidence.
        </p>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex w-fit items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          See the evidence <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 content-start">
        {[
          { value: n > 0 ? `${n}` : "109+", label: "Countries assessed", sub: "2005–2023", col: "text-blue-600 dark:text-blue-400" },
          { value: r !== null ? fmtR(r) : "−0.47", label: "Budget execution × child mortality", sub: "Better PFM → lower mortality", col: "text-emerald-600 dark:text-emerald-400" },
          { value: "75%", label: "Public financing threshold", sub: "Piatti: effect strongest above", col: "text-amber-600 dark:text-amber-400" },
          { value: "PI-23", label: "Last-mile indicator", sub: "Does money reach the clinic?", col: "text-purple-600 dark:text-purple-400" },
        ].map(({ value, label, sub, col }) => (
          <div key={label} className="rounded-xl border bg-muted/30 px-4 py-4 shadow-sm">
            <p className={`text-3xl font-bold tabular-nums ${col}`}>{value}</p>
            <p className="mt-1.5 text-xs font-medium leading-snug">{label}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HookExpanded({ points }: { points: PfmScatterPoint[] }) {
  // Assessment-year histogram data
  const yearCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of points) {
      const y = p.pefa_assessment_year;
      if (y) map.set(y, (map.get(y) ?? 0) + 1);
    }
    const entries = [...map.entries()].sort((a, b) => a[0] - b[0]);
    return { years: entries.map(([y]) => y), counts: entries.map(([, c]) => c) };
  }, [points]);

  const pillars = [
    { n: 1, name: "Budget reliability", desc: "Are expenditures and revenues as planned?", highlight: false },
    { n: 2, name: "Transparency of public finances", desc: "Comprehensive, consistent, accessible information", highlight: false },
    { n: 3, name: "Management of assets & liabilities", desc: "Effective management of public assets and debt", highlight: false },
    { n: 4, name: "Policy-based fiscal strategy & budgeting", desc: "Budget prepared with medium-term perspective", highlight: false },
    { n: 5, name: "Predictability & Control in Budget Execution", desc: "Revenue collected and expenditure controlled as budgeted", highlight: true },
    { n: 6, name: "Accounting & reporting", desc: "Accurate and timely records and reports", highlight: false },
    { n: 7, name: "External scrutiny & audit", desc: "Independent review of public finances", highlight: false },
  ];

  const grades = [
    { grade: "A", range: "3.5 – 4.0", desc: "Excellent — fully meets requirements", color: "#059669" },
    { grade: "B", range: "2.5 – 3.49", desc: "Good — largely meets requirements", color: "#2563eb" },
    { grade: "C", range: "1.5 – 2.49", desc: "Basic — partially meets requirements", color: "#d97706" },
    { grade: "D", range: "0 – 1.49", desc: "Poor — falls short of requirements", color: "#dc2626" },
  ];

  return (
    <div className="mt-4 space-y-6 border-t pt-5">
      <SectionHeading>How PEFA works</SectionHeading>
      <div className="grid gap-6 md:grid-cols-3">
        {/* Pillars */}
        <div className="md:col-span-2 space-y-1.5">
          <p className="text-xs font-semibold text-foreground mb-2">PEFA 2016 framework — 7 pillars</p>
          {pillars.map((p) => (
            <div
              key={p.n}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${
                p.highlight
                  ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40"
                  : "bg-card"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  p.highlight ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {p.n}
              </span>
              <div className="min-w-0">
                <p className={`text-xs font-medium ${p.highlight ? "text-blue-700 dark:text-blue-300" : ""}`}>
                  {p.name}
                  {p.highlight && (
                    <span className="ml-2 rounded bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 text-[9px] text-blue-700 dark:text-blue-300">
                      Tapsoba focus
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Grades + assessment frequency */}
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Score → letter grade</p>
            <div className="space-y-1.5">
              {grades.map(({ grade, range, desc, color }) => (
                <div key={grade} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {grade}
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold tabular-nums">{range}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {yearCounts.years.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">Assessments per year</p>
              <div className="h-[140px]">
                <PlotlyChart
                  className="h-full"
                  data={[{
                    type: "bar",
                    x: yearCounts.years,
                    y: yearCounts.counts,
                    marker: { color: "#2563eb", opacity: 0.75 },
                    hovertemplate: "%{x}: %{y} countries<extra></extra>",
                  } as Data]}
                  layout={{
                    margin: { l: 28, r: 8, t: 8, b: 30 },
                    xaxis: { tickfont: { size: 9 } },
                    yaxis: { tickfont: { size: 9 } },
                  }}
                />
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Scores are forward-carried up to 4 years after each assessment to create an annual panel, preserving provenance metadata throughout.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1 · Global pattern ──────────────────────────────────────────────────

function PatternStep({
  points, r, n, expanded, onToggleExpand, onClickPoint,
}: {
  points: PfmScatterPoint[]; r: number | null; n: number;
  expanded: boolean; onToggleExpand: () => void;
  onClickPoint: (iso3: string) => void;
}) {
  const traces = useMemo(() => buildIncomeTraces(points), [points]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-lg">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Finding 1 · Tapsoba et al. (2024)</p>
          <h2 className="mt-1.5 text-xl font-bold tracking-tight">
            Stronger budget execution → lower child mortality
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The PEFA "Predictability &amp; Control in Budget Execution" pillar correlates
            meaningfully with under-5 mortality across {n} countries. Bubble size ∝ public-financing
            share. <span className="font-medium text-foreground">Click any point</span> for the country timeline.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <div className="rounded-xl border bg-muted/30 px-5 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Your data</p>
            <p className={`mt-0.5 text-3xl font-bold tabular-nums ${r !== null && r < -0.3 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
              {fmtR(r)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">n = {n}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 px-5 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Paper (SSA)</p>
            <p className="mt-0.5 text-3xl font-bold tabular-nums text-muted-foreground">−0.47</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Tapsoba 2024</p>
          </div>
        </div>
      </div>
      <div className="h-[320px] rounded-lg border bg-card p-3">
        {points.length === 0 ? <EmptyChart /> : (
          <PlotlyChart
            className="h-full" data={traces} layout={SCATTER_LAYOUT_BASE}
            onClick={(e: Readonly<PlotMouseEvent>) => {
              const iso3 = (e.points[0] as { text?: string }).text;
              if (iso3) onClickPoint(iso3);
            }}
          />
        )}
      </div>
      <ExpandToggle expanded={expanded} onToggle={onToggleExpand} label="Break it down by income group" />
      {expanded && <PatternExpanded points={points} />}
    </div>
  );
}

function PatternExpanded({ points }: { points: PfmScatterPoint[] }) {
  const groupStats = useMemo(() =>
    INCOME_GROUP_ORDER.filter(g => g !== "Not classified").map((g) => {
      const pts = points.filter((p) => p.income_group === g);
      const pairs = pts.map((p): [number, number] => [p.pfm_score, p.outcome_value]);
      const r = pearsonR(pairs);
      return { group: g, r, n: pts.length, avgScore: pts.length > 0 ? pts.reduce((s, p) => s + p.pfm_score, 0) / pts.length : null };
    }),
    [points],
  );

  const top10 = useMemo(
    () => [...points].sort((a, b) => b.pfm_score - a.pfm_score).slice(0, 10),
    [points],
  );

  const scoreDistData: Data[] = [{
    type: "histogram",
    x: points.map((p) => p.pfm_score),
    nbinsx: 20,
    marker: { color: "#2563eb", opacity: 0.72 },
    name: "Countries",
    hovertemplate: "Score %{x:.1f}: %{y} countries<extra></extra>",
  } as Data];

  const rBarData: Data[] = [{
    type: "bar",
    orientation: "h",
    x: groupStats.map((g) => g.r ?? 0),
    y: groupStats.map((g) => g.group),
    marker: { color: groupStats.map((g) => INCOME_GROUP_COLORS[g.group] ?? "#9ca3af") },
    text: groupStats.map((g) => g.r !== null ? `${fmtR(g.r)} (n=${g.n})` : "—"),
    textposition: "outside" as const,
    hovertemplate: "%{y}: r = %{x:.2f}<extra></extra>",
  } as Data];

  return (
    <div className="mt-2 space-y-5 border-t pt-5">
      <SectionHeading>Breakdown by income group</SectionHeading>
      <div className="grid gap-4 md:grid-cols-2">
        {/* r by income group */}
        <div>
          <p className="mb-1.5 text-xs font-semibold">Correlation by income group</p>
          <p className="mb-2 text-[11px] text-muted-foreground">
            The PFM–mortality link is strongest in low-income countries — where public systems are dominant and private alternatives scarce.
          </p>
          <div className="h-[200px] rounded-lg border bg-card p-2">
            <PlotlyChart
              className="h-full"
              data={rBarData}
              layout={{
                margin: { l: 140, r: 60, t: 12, b: 30 },
                xaxis: { title: { text: "Pearson r" }, range: [-1.1, 0.3] },
                yaxis: { automargin: true, tickfont: { size: 10 } },
                shapes: [{ type: "line" as const, x0: 0, x1: 0, y0: 0, y1: 1, xref: "x" as const, yref: "paper" as const, line: { color: "#9ca3af", width: 1 } }],
              }}
            />
          </div>
        </div>

        {/* Score distribution */}
        <div>
          <p className="mb-1.5 text-xs font-semibold">Distribution of PCBE pillar scores</p>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Most assessed countries cluster in the 1.5–3 range (C–B). Very few reach "A" — the majority still have meaningful room to improve.
          </p>
          <div className="h-[200px] rounded-lg border bg-card p-2">
            <PlotlyChart
              className="h-full"
              data={scoreDistData}
              layout={{
                margin: { l: 36, r: 12, t: 12, b: 36 },
                xaxis: { title: { text: "PCBE score (0–4)" }, range: [0, 4.2] },
                yaxis: { title: { text: "Countries" } },
                shapes: [1.5, 2.5, 3.5].map((x) => ({
                  type: "line" as const, x0: x, x1: x, y0: 0, y1: 1,
                  xref: "x" as const, yref: "paper" as const,
                  line: { color: "#e5e7eb", width: 1, dash: "dot" as const },
                })),
              }}
            />
          </div>
        </div>
      </div>

      {/* Top 10 table */}
      <div>
        <p className="mb-2 text-xs font-semibold">Top 10 countries by PCBE pillar score</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                {["Rank", "Country", "ISO3", "PCBE", "U5MR", "Income group", "PEFA year"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top10.map((p, i) => (
                <tr key={p.iso3} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                  <td className="px-3 py-1.5 text-muted-foreground">#{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium">{p.country_name}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.iso3}</td>
                  <td className="px-3 py-1.5 tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{p.pfm_score.toFixed(2)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{p.outcome_value.toFixed(1)}</td>
                  <td className="px-3 py-1.5">
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: INCOME_GROUP_COLORS[p.income_group] ?? "#9ca3af" }}>
                      {p.income_group}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{p.pefa_assessment_year ?? p.year}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2 · Financing threshold ─────────────────────────────────────────────

function ThresholdStep({
  points, rHigh, rLow, expanded, onToggleExpand, onClickPoint,
}: {
  points: PfmScatterPoint[];
  rHigh: { r: number | null; n: number }; rLow: { r: number | null; n: number };
  expanded: boolean; onToggleExpand: () => void;
  onClickPoint: (iso3: string) => void;
}) {
  const traces = useMemo(() => buildFinancingTraces(points), [points]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-lg">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Finding 2 · Piatti-Fünfkirchen &amp; Smets</p>
          <h2 className="mt-1.5 text-xl font-bold tracking-tight">
            PFM matters most where<br className="hidden sm:block" /> public financing dominates
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            When private spending dominates, PFM improvements have little effect — public budget systems
            influence a smaller share of total health spending. Above the{" "}
            <span className="font-medium text-amber-600 dark:text-amber-400">75% threshold</span>, the
            association is stronger. Colour shows each country's financing regime.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          {[
            { label: "High financing (>75%)", stat: rHigh, color: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-900" },
            { label: "Low financing (<50%)", stat: rLow, color: "text-rose-600 dark:text-rose-400", border: "border-rose-200 dark:border-rose-900" },
          ].map(({ label, stat, color, border }) => (
            <div key={label} className={`rounded-xl border bg-muted/30 px-4 py-3 text-center ${border}`}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className={`mt-0.5 text-3xl font-bold tabular-nums ${color}`}>{fmtR(stat.r)}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">n = {stat.n}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="h-[320px] rounded-lg border bg-card p-3">
        {points.length === 0 ? <EmptyChart /> : (
          <PlotlyChart
            className="h-full" data={traces}
            layout={{ ...SCATTER_LAYOUT_BASE, legend: { ...SCATTER_LAYOUT_BASE.legend, title: { text: "GGHE-D / CHE" } } }}
            onClick={(e: Readonly<PlotMouseEvent>) => {
              const iso3 = (e.points[0] as { text?: string }).text;
              if (iso3) onClickPoint(iso3);
            }}
          />
        )}
      </div>
      <ExpandToggle expanded={expanded} onToggle={onToggleExpand} label="Explore the financing distribution" />
      {expanded && <ThresholdExpanded points={points} rHigh={rHigh} rLow={rLow} />}
    </div>
  );
}

function ThresholdExpanded({
  points,
  rHigh,
  rLow,
}: {
  points: PfmScatterPoint[];
  rHigh: { r: number | null; n: number };
  rLow: { r: number | null; n: number };
}) {
  const rMid = useMemo(() => {
    const pairs = points
      .filter((p) => regimeOf(p.gghed_pct_che) === "mid (50–75%)")
      .map((p): [number, number] => [p.pfm_score, p.outcome_value]);
    return { r: pearsonR(pairs), n: pairs.length };
  }, [points]);

  const regimeCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of points) {
      const regime = regimeOf(p.gghed_pct_che);
      map[regime] = (map[regime] ?? 0) + 1;
    }
    return map;
  }, [points]);

  const histData: Data[] = useMemo(() => {
    const vals = points.map((p) => p.gghed_pct_che).filter((v): v is number => v !== null);
    return [{
      type: "histogram",
      x: vals,
      nbinsx: 25,
      marker: { color: "#2563eb", opacity: 0.7 },
      name: "Countries",
      hovertemplate: "%{x:.0f}%: %{y} countries<extra></extra>",
    } as Data];
  }, [points]);

  const regimeR = [
    { label: "Low (<50%)", r: rLow.r, n: rLow.n, color: FINANCING_COLORS["low (<50%)"] },
    { label: "Mid (50–75%)", r: rMid.r, n: rMid.n, color: FINANCING_COLORS["mid (50–75%)"] },
    { label: "High (>75%)", r: rHigh.r, n: rHigh.n, color: FINANCING_COLORS["high (>75%)"] },
  ];

  return (
    <div className="mt-2 space-y-5 border-t pt-5">
      <SectionHeading>Financing regime — deep dive</SectionHeading>
      <div className="grid gap-4 md:grid-cols-2">
        {/* Distribution histogram */}
        <div>
          <p className="mb-1.5 text-xs font-semibold">Where countries cluster on GGHE-D / CHE</p>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Most low- and middle-income countries sit below the 75% threshold, meaning the private
            sector — often out-of-pocket — carries a large share of health spending.
          </p>
          <div className="h-[220px] rounded-lg border bg-card p-2">
            <PlotlyChart
              className="h-full"
              data={histData}
              layout={{
                margin: { l: 36, r: 12, t: 12, b: 36 },
                xaxis: { title: { text: "GGHE-D / CHE (%)" }, range: [0, 105] },
                yaxis: { title: { text: "Countries" } },
                shapes: [
                  { type: "line" as const, x0: 50, x1: 50, y0: 0, y1: 1, xref: "x" as const, yref: "paper" as const, line: { color: "#6b7280", width: 1.5, dash: "dot" as const } },
                  { type: "line" as const, x0: 75, x1: 75, y0: 0, y1: 1, xref: "x" as const, yref: "paper" as const, line: { color: "#d97706", width: 1.5, dash: "dash" as const } },
                ],
                annotations: [
                  { x: 50, y: 1, xref: "x" as const, yref: "paper" as const, text: "50%", showarrow: false, yanchor: "bottom" as const, font: { size: 10, color: "#6b7280" } },
                  { x: 75, y: 1, xref: "x" as const, yref: "paper" as const, text: "75% (Piatti)", showarrow: false, yanchor: "bottom" as const, font: { size: 10, color: "#d97706" } },
                ],
              }}
            />
          </div>
        </div>

        {/* r by regime + regime breakdown */}
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold">Correlation by financing regime</p>
            <p className="mb-3 text-[11px] text-muted-foreground">
              The jump from low → high financing is stark: PFM reforms are near-irrelevant when
              governments cover less than half of health spending.
            </p>
            <div className="space-y-2">
              {regimeR.map(({ label, r, n, color }) => (
                <div key={label} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground">n = {n}</p>
                  </div>
                  <span className="tabular-nums text-sm font-bold" style={{ color }}>
                    {fmtR(r)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold">Countries by financing regime</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "low (<50%)", label: "Low\n(<50%)" },
                { key: "mid (50–75%)", label: "Mid\n(50–75%)" },
                { key: "high (>75%)", label: "High\n(>75%)" },
              ].map(({ key, label }) => (
                <div key={key} className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums" style={{ color: FINANCING_COLORS[key] }}>
                    {regimeCounts[key] ?? 0}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground whitespace-pre-line">{label}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Countries without GGHE-D data excluded. Source: WHO Global Health Expenditure Database.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3 · Last mile ───────────────────────────────────────────────────────

function LastMileStep({
  rows, expanded, onToggleExpand, onViewAll,
}: {
  rows: PfmLastMileRow[];
  expanded: boolean; onToggleExpand: () => void;
  onViewAll: () => void;
}) {
  const top = useMemo(() => rows.slice(0, 20), [rows]);
  const traces = useMemo((): Data[] =>
    INCOME_GROUP_ORDER.map((g) => {
      const pts = top.filter((r) => r.income_group === g);
      return {
        type: "bar", orientation: "h", name: g,
        x: pts.map((r) => r.pi23_score),
        y: pts.map((r) => r.country_name),
        marker: { color: INCOME_GROUP_COLORS[g] ?? "#9ca3af" },
        hovertemplate: "<b>%{y}</b><br>PI-23: %{x:.2f}<extra></extra>",
      } as Data;
    }).filter((t) => (t as { x: unknown[] }).x.length > 0),
    [top],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-lg">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Finding 3 · PEFA PI-23</p>
          <h2 className="mt-1.5 text-xl font-bold tracking-tight">
            Do public funds reach service-delivery units?
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            PI-23 measures whether budget allocations reach front-line service-delivery units.
            Countries scoring A have measurably higher immunisation rates and lower mortality.
            Weak execution can reduce the funds that reach facilities and health workers.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1.5">
            {(["A ≥3.5", "B 2.5–3.5", "C 1.5–2.5", "D <1.5"] as const).map((g) => (
              <span key={g} className="rounded border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground">{g}</span>
            ))}
          </div>
          <button type="button" onClick={onViewAll} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            View all countries + outcome scatter <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3" style={{ height: Math.max(280, top.length * 20 + 60) }}>
        {rows.length === 0 ? <EmptyChart /> : (
          <PlotlyChart
            className="h-full" data={traces}
            layout={{
              barmode: "stack",
              xaxis: { title: { text: "PI-23 score (0–4)" }, range: [0, 4.2] },
              yaxis: { automargin: true, tickfont: { size: 10 } },
              margin: { l: 130, r: 24, t: 24, b: 40 },
              legend: { orientation: "h" as const, yanchor: "bottom" as const, y: 1.02, xanchor: "left" as const, x: 0 },
              shapes: [1.5, 2.5, 3.5].map((x) => ({
                type: "line" as const, x0: x, x1: x, y0: 0, y1: 1,
                xref: "x" as const, yref: "paper" as const,
                line: { color: "#d1d5db", width: 1, dash: "dot" as const },
              })),
            }}
          />
        )}
      </div>
      <ExpandToggle expanded={expanded} onToggle={onToggleExpand} label="See how PI-23 links to health outcomes" />
      {expanded && <LastMileExpanded rows={rows} />}
    </div>
  );
}

function LastMileExpanded({ rows }: { rows: PfmLastMileRow[] }) {
  const dtp3Rows  = useMemo(() => rows.filter((r) => r.dtp3_coverage !== null), [rows]);
  const u5mrRows  = useMemo(() => rows.filter((r) => r.u5mr !== null), [rows]);

  const dtp3Traces: Data[] = useMemo(() =>
    INCOME_GROUP_ORDER.map((g) => {
      const pts = dtp3Rows.filter((r) => r.income_group === g);
      return {
        type: "scatter", mode: "markers", name: g,
        x: pts.map((r) => r.pi23_score),
        y: pts.map((r) => r.dtp3_coverage),
        text: pts.map((r) => r.iso3),
        customdata: pts.map((r) => [r.country_name]),
        marker: { color: INCOME_GROUP_COLORS[g] ?? "#9ca3af", size: 8, opacity: 0.8, line: { width: 0.5, color: "#fff" } },
        hovertemplate: "<b>%{customdata[0]}</b><br>PI-23: %{x:.2f}<br>DTP3: %{y:.1f}%<extra></extra>",
      } as Data;
    }).filter((t) => (t as { x: unknown[] }).x.length > 0),
    [dtp3Rows],
  );

  const u5mrTraces: Data[] = useMemo(() =>
    INCOME_GROUP_ORDER.map((g) => {
      const pts = u5mrRows.filter((r) => r.income_group === g);
      return {
        type: "scatter", mode: "markers", name: g, showlegend: false,
        x: pts.map((r) => r.pi23_score),
        y: pts.map((r) => r.u5mr),
        text: pts.map((r) => r.iso3),
        customdata: pts.map((r) => [r.country_name]),
        marker: { color: INCOME_GROUP_COLORS[g] ?? "#9ca3af", size: 8, opacity: 0.8, line: { width: 0.5, color: "#fff" } },
        hovertemplate: "<b>%{customdata[0]}</b><br>PI-23: %{x:.2f}<br>U5MR: %{y:.1f}<extra></extra>",
      } as Data;
    }).filter((t) => (t as { x: unknown[] }).x.length > 0),
    [u5mrRows],
  );

  // Grade breakdown counts
  const gradeStats = useMemo(() => {
    const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const r of rows) {
      if (r.pi23_score >= 3.5) grades.A++;
      else if (r.pi23_score >= 2.5) grades.B++;
      else if (r.pi23_score >= 1.5) grades.C++;
      else grades.D++;
    }
    return grades;
  }, [rows]);

  const dtp3R = useMemo(() => {
    const pairs = dtp3Rows.map((r): [number, number] => [r.pi23_score, r.dtp3_coverage!]);
    return pearsonR(pairs);
  }, [dtp3Rows]);

  const u5mrR = useMemo(() => {
    const pairs = u5mrRows.map((r): [number, number] => [r.pi23_score, r.u5mr!]);
    return pearsonR(pairs);
  }, [u5mrRows]);

  const scatterLayout = (yTitle: string) => ({
    margin: { l: 48, r: 12, t: 12, b: 40 },
    xaxis: { title: { text: "PI-23 score (0–4)" }, range: [0, 4.2] },
    yaxis: { title: { text: yTitle } },
    showlegend: false,
  });

  return (
    <div className="mt-2 space-y-5 border-t pt-5">
      <SectionHeading>PI-23 → health outcomes</SectionHeading>
      <div className="grid gap-4 md:grid-cols-2">
        {/* DTP3 */}
        <div>
          <div className="mb-1.5 flex items-baseline gap-2">
            <p className="text-xs font-semibold">PI-23 × DTP3 immunisation coverage</p>
            <span className={`text-xs font-bold tabular-nums ${dtp3R !== null && dtp3R > 0.2 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
              r = {fmtR(dtp3R)}
            </span>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Countries where budgets reliably reach clinics tend to have higher vaccine coverage —
            a direct test of last-mile effectiveness.
          </p>
          <div className="h-[220px] rounded-lg border bg-card p-2">
            {dtp3Rows.length === 0 ? <EmptyChart /> : (
              <PlotlyChart className="h-full" data={dtp3Traces} layout={scatterLayout("DTP3 coverage (%)")} />
            )}
          </div>
        </div>

        {/* U5MR */}
        <div>
          <div className="mb-1.5 flex items-baseline gap-2">
            <p className="text-xs font-semibold">PI-23 × Under-5 mortality rate</p>
            <span className={`text-xs font-bold tabular-nums ${u5mrR !== null && u5mrR < -0.2 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
              r = {fmtR(u5mrR)}
            </span>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Higher PI-23 scores associate with lower child mortality — but the causal chain
            runs through many intermediate steps from budget to bedside.
          </p>
          <div className="h-[220px] rounded-lg border bg-card p-2">
            {u5mrRows.length === 0 ? <EmptyChart /> : (
              <PlotlyChart className="h-full" data={u5mrTraces} layout={scatterLayout("U5MR (per 1,000)")} />
            )}
          </div>
        </div>
      </div>

      {/* Grade breakdown */}
      <div>
        <p className="mb-2 text-xs font-semibold">Grade breakdown across all assessed countries</p>
        <div className="grid grid-cols-4 gap-2">
          {[
            { grade: "A", label: "Excellent", range: "≥ 3.5", color: "#059669" },
            { grade: "B", label: "Good",      range: "2.5–3.5", color: "#2563eb" },
            { grade: "C", label: "Basic",     range: "1.5–2.5", color: "#d97706" },
            { grade: "D", label: "Poor",      range: "< 1.5", color: "#dc2626" },
          ].map(({ grade, label, range, color }) => (
            <div key={grade} className="rounded-xl border bg-muted/30 px-3 py-3 text-center">
              <span className="flex h-8 w-8 mx-auto items-center justify-center rounded-lg text-sm font-bold text-white mb-2" style={{ backgroundColor: color }}>
                {grade}
              </span>
              <p className="text-2xl font-bold tabular-nums">{gradeStats[grade]}</p>
              <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
              <p className="text-[10px] text-muted-foreground/70">{range}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Step 4 · Interactive explorer ────────────────────────────────────────────

function ExploreStep({
  basePoints, expanded, onToggleExpand, onClickPoint,
}: {
  basePoints: PfmScatterPoint[];
  expanded: boolean; onToggleExpand: () => void;
  onClickPoint: (iso3: string) => void;
}) {
  const { conn } = useDuckDB();
  const [scoreCode, setScoreCode]   = useState<PfmScoreCode>("pillar3");
  const [outcomeCode, setOutcomeCode] = useState<PfmOutcomeCode>("u5mr");
  const [ssaOnly, setSsaOnly]       = useState(false);
  const [colourMode, setColourMode] = useState<"income" | "financing">("income");
  const [points, setPoints]         = useState<PfmScatterPoint[]>(basePoints);
  const [loading, setLoading]       = useState(false);

  const score   = PFM_SCORE_OPTIONS.find((s) => s.code === scoreCode)!;
  const outcome = PFM_OUTCOME_OPTIONS.find((o) => o.code === outcomeCode)!;

  useEffect(() => {
    if (!conn) return;
    if (scoreCode === "pillar3" && outcomeCode === "u5mr" && !ssaOnly) {
      setPoints(basePoints); return;
    }
    setLoading(true);
    getPfmScatter(conn, scoreCode, outcomeCode, { ssaOnly })
      .then(setPoints).catch(console.error).finally(() => setLoading(false));
  }, [conn, scoreCode, outcomeCode, ssaOnly, basePoints]);

  const traces = useMemo(
    () => colourMode === "income" ? buildIncomeTraces(points) : buildFinancingTraces(points),
    [points, colourMode],
  );

  const currentR = useMemo(() => {
    const pairs = points.map((p): [number, number] => [p.pfm_score, p.outcome_value]);
    return pearsonR(pairs);
  }, [points]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Your turn</p>
          <h2 className="mt-1.5 text-xl font-bold tracking-tight">Explore the full dataset</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select any PFM score × health outcome. Click a bubble to drill into that country's timeline.
          </p>
        </div>
        {currentR !== null && (
          <div className="shrink-0 rounded-xl border bg-muted/30 px-4 py-2 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pearson r</p>
            <p className={`text-2xl font-bold tabular-nums ${Math.abs(currentR) >= 0.3 ? "text-foreground" : "text-muted-foreground"}`}>
              {fmtR(currentR)}
            </p>
            <p className="text-[10px] text-muted-foreground">n = {points.length}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-lg border bg-muted/30 px-4 py-3">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PFM score</p>
          <div className="flex flex-wrap gap-1">
            {PFM_SCORE_OPTIONS.map((s) => (
              <button key={s.code} type="button" onClick={() => setScoreCode(s.code)} title={s.label}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${scoreCode === s.code ? "border-foreground/30 bg-accent text-accent-foreground" : "border-border bg-transparent text-muted-foreground hover:text-foreground"}`}>
                {s.shortLabel}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Health outcome</p>
          <div className="flex flex-wrap gap-1">
            {PFM_OUTCOME_OPTIONS.map((o) => (
              <button key={o.code} type="button" onClick={() => setOutcomeCode(o.code)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${outcomeCode === o.code ? "border-foreground/30 bg-accent text-accent-foreground" : "border-border bg-transparent text-muted-foreground hover:text-foreground"}`}>
                {o.shortLabel}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Colour by</p>
          <div className="flex gap-1.5">
            {(["income", "financing"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setColourMode(m)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium ${colourMode === m ? "border-foreground/30 bg-accent text-accent-foreground" : "border-border bg-transparent text-muted-foreground hover:text-foreground"}`}>
                {m === "income" ? "Income group" : "Financing regime"}
              </button>
            ))}
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
              <input type="checkbox" checked={ssaOnly} onChange={(e) => setSsaOnly(e.target.checked)} className="h-3 w-3 accent-blue-600" />
              SSA only
            </label>
          </div>
        </div>
      </div>

      <div className="h-[340px] rounded-lg border bg-card p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-muted border-t-foreground" />
          </div>
        ) : points.length === 0 ? <EmptyChart /> : (
          <PlotlyChart
            className="h-full" data={traces}
            layout={{
              xaxis: { title: { text: score.shortLabel }, range: [0, 4.2] },
              yaxis: { title: { text: `${outcome.shortLabel} (${outcome.unit})` } },
              legend: { orientation: "h" as const, yanchor: "bottom" as const, y: 1.02, xanchor: "left" as const, x: 0 },
            }}
            onClick={(e: Readonly<PlotMouseEvent>) => {
              const iso3 = (e.points[0] as { text?: string }).text;
              if (iso3) onClickPoint(iso3);
            }}
          />
        )}
      </div>

      <ExpandToggle expanded={expanded} onToggle={onToggleExpand} label="See leaderboard & score definitions" />
      {expanded && <ExploreExpanded points={points} score={score} outcome={outcome} />}
    </div>
  );
}

function ExploreExpanded({
  points, score, outcome,
}: {
  points: PfmScatterPoint[];
  score: typeof PFM_SCORE_OPTIONS[number];
  outcome: typeof PFM_OUTCOME_OPTIONS[number];
}) {
  const sorted = useMemo(
    () => [...points].sort((a, b) =>
      outcome.invertGood
        ? a.outcome_value - b.outcome_value   // lower = better
        : b.outcome_value - a.outcome_value,  // higher = better
    ),
    [points, outcome.invertGood],
  );

  const top5 = sorted.slice(0, 5);
  const bot5 = sorted.slice(-5).reverse();

  const scoreDefs = [
    { code: "pillar3",      name: "PCBE pillar",     desc: "Predictability & Control in Budget Execution (PIs 19–26 of PEFA 2016). Tapsoba's headline measure. Covers payroll, procurement, internal controls, and audit. Coalesces to PEFA 2011 equivalent if 2016 unavailable." },
    { code: "overall",      name: "Overall PEFA",    desc: "Unweighted average of all PEFA performance indicators (2016: 31 PIs; 2011: 28 PIs). Broad governance signal but dilutes sector-specific effects." },
    { code: "budget_reliab",name: "Budget reliability", desc: "Average of PIs 1–3: aggregate expenditure outturn, expenditure composition outturn, and revenue outturn. Measures whether budgets are credible as a planning instrument." },
    { code: "pi23",         name: "PI-23 last mile", desc: "Single indicator: 'Resources reaching service-delivery units.' Directly tests whether budget allocations survive the journey from treasury to clinic. PEFA 2016 only." },
  ];

  return (
    <div className="mt-2 space-y-5 border-t pt-5">
      <SectionHeading>Leaderboard &amp; definitions</SectionHeading>
      <div className="grid gap-6 md:grid-cols-2">
        {/* Leaderboard */}
        <div>
          <p className="mb-2 text-xs font-semibold">
            Best &amp; worst performers — {score.shortLabel} × {outcome.shortLabel}
          </p>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Country</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PFM</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{outcome.shortLabel}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td colSpan={3} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">Top 5 on outcome</td></tr>
                {top5.map((p) => (
                  <tr key={p.iso3} className="border-t bg-card">
                    <td className="px-3 py-1.5 font-medium">{p.country_name} <span className="text-muted-foreground font-normal">({p.iso3})</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.pfm_score.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{p.outcome_value.toFixed(1)}</td>
                  </tr>
                ))}
                <tr><td colSpan={3} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30">Bottom 5 on outcome</td></tr>
                {bot5.map((p) => (
                  <tr key={p.iso3} className="border-t bg-card">
                    <td className="px-3 py-1.5 font-medium">{p.country_name} <span className="text-muted-foreground font-normal">({p.iso3})</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.pfm_score.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-rose-600 dark:text-rose-400">{p.outcome_value.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Score definitions */}
        <div>
          <p className="mb-2 text-xs font-semibold">What each PFM score measures</p>
          <div className="space-y-2">
            {scoreDefs.map(({ code, name, desc }) => (
              <div
                key={code}
                className={`rounded-lg border px-3 py-2.5 ${score.code === code ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30" : "bg-card"}`}
              >
                <p className={`text-xs font-semibold ${score.code === code ? "text-blue-700 dark:text-blue-300" : ""}`}>
                  {name}
                  {score.code === code && <span className="ml-2 text-[9px] font-normal">← selected</span>}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            <strong>Carry-forward rule:</strong> PEFA assessments are irregular (every 3–5 years). Scores are projected forward up to 4 years to populate annual panels, with provenance tracking (assessment year, framework, years since assessment).
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Navigation components ────────────────────────────────────────────────────

function StepIndicator({
  current, onSelect,
}: { current: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEP_DEFS.map((step, i) => {
        const Icon = step.icon;
        return (
          <button key={step.id} type="button" onClick={() => onSelect(i)} title={step.label}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
              i === current
                ? "border-foreground/20 bg-foreground text-background"
                : i < current
                  ? "border-border bg-card text-muted-foreground hover:text-foreground"
                  : "border-border bg-card text-muted-foreground/50 hover:text-muted-foreground"
            }`}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="hidden sm:inline">{step.label}</span>
            <span className="sm:hidden">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

function NavBar({ step, onPrev, onNext }: { step: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <button type="button" onClick={onPrev} disabled={step === 0}
        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30">
        <ChevronLeft className="h-3.5 w-3.5" /> Back
      </button>
      <div className="flex gap-1.5">
        {STEP_DEFS.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/30"}`} />
        ))}
      </div>
      <button type="button" onClick={onNext} disabled={step === STEP_DEFS.length - 1}
        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30">
        Next <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function PfmLanding() {
  const router = useRouter();
  const [step, setStep]         = useState(0);
  const [expanded, setExpanded] = useState(false);

  const { available, points, rAll, rHigh, rLow, lastMile, loading } = useNarrativeData();

  const goTo = useCallback((i: number) => { setStep(i); setExpanded(false); }, []);
  const prev = useCallback(() => goTo(Math.max(0, step - 1)), [step, goTo]);
  const next = useCallback(() => goTo(Math.min(STEP_DEFS.length - 1, step + 1)), [step, goTo]);
  const toggleExpand = useCallback(() => setExpanded((e) => !e), []);

  const clickPoint = useCallback((iso3: string) => router.push(`/country/${iso3}/pfm`), [router]);
  const viewLastMile = useCallback(() => router.push("/global/pfm/last-mile"), [router]);
  const viewChain = useCallback(() => router.push("/global/pfm/chain"), [router]);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-10">
        <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Public Financial Management × Health Outcomes
        </p>

        {/* Carousel card */}
        <div className="rounded-2xl border bg-card shadow-sm">
          {/* Top bar */}
          <div className="flex items-center justify-between border-b px-5 py-3">
            <StepIndicator current={step} onSelect={goTo} />
            <span className="text-[11px] text-muted-foreground">{step + 1} / {STEP_DEFS.length}</span>
          </div>

          {/* Content */}
          <div className="px-5 py-5">
            {loading && step > 0 ? (
              <div className="flex h-[400px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
              </div>
            ) : (
              <>
                {step === 0 && (
                  <>
                    <HookStep n={rAll.n} r={rAll.r} onNext={next} />
                    <div className="mt-4 flex justify-center">
                      <ExpandToggle expanded={expanded} onToggle={toggleExpand} label="Understand the PEFA framework" />
                    </div>
                    {expanded && <HookExpanded points={points} />}
                  </>
                )}
                {step === 1 && (
                  <PatternStep points={points} r={rAll.r} n={rAll.n}
                    expanded={expanded} onToggleExpand={toggleExpand} onClickPoint={clickPoint} />
                )}
                {step === 2 && (
                  <ThresholdStep points={points} rHigh={rHigh} rLow={rLow}
                    expanded={expanded} onToggleExpand={toggleExpand} onClickPoint={clickPoint} />
                )}
                {step === 3 && (
                  <LastMileStep rows={lastMile}
                    expanded={expanded} onToggleExpand={toggleExpand} onViewAll={viewLastMile} />
                )}
                {step === 4 && (
                  <ExploreStep basePoints={points}
                    expanded={expanded} onToggleExpand={toggleExpand} onClickPoint={clickPoint} />
                )}
              </>
            )}
          </div>

          {/* Nav */}
          <div className="border-t px-5 py-3">
            <NavBar step={step} onPrev={prev} onNext={next} />
          </div>
        </div>

        {/* Footer links */}
        <div className="mt-5 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <button type="button" onClick={viewLastMile}
            className="inline-flex items-center gap-1 hover:text-foreground">
            <BarChart2 className="h-3.5 w-3.5" /> Full PI-23 last-mile panel
          </button>
          <span className="text-border">·</span>
          <button type="button" onClick={viewChain}
            className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowRight className="h-3.5 w-3.5" /> Budget → health chain
          </button>
          <span className="text-border">·</span>
          <span>Click any scatter point to open country drill-down</span>
          <span className="text-border">·</span>
          <span>Sources: PEFA Secretariat · WHO GHED · WGI · WB DataBank</span>
        </div>
        <CompassFooter />
      </div>
  );
}
