"use client";

import { Compass } from "@/components/layout/compass";

import { useEffect, useState, useMemo, useCallback } from "react";
import { ArrowRight, Info } from "lucide-react";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getPfmChainData, pfmMartsAvailable } from "@/lib/pfm-queries";
import type { PfmChainPoint } from "@/lib/pfm-types";
import { INCOME_GROUP_COLORS, INCOME_GROUP_ORDER } from "@/components/charts/chart-config";
import type { Data } from "plotly.js-dist-min";

// ─── types ───────────────────────────────────────────────────────────────────

type NodeKey = "pfm" | "workforce" | "coverage" | "outcomes";
type ChainLink = { from: NodeKey; to: NodeKey };

interface LinkDef {
  id: string;
  from: NodeKey;
  to: NodeKey;
  xLabel: string;
  yLabel: string;
  xField: keyof PfmChainPoint;
  yField: keyof PfmChainPoint;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  note?: string;
}

const CHAIN_LINKS: LinkDef[] = [
  {
    id: "pfm-workforce",
    from: "pfm",
    to: "workforce",
    xLabel: "PCBE pillar score (0–4)",
    yLabel: "Physicians per 10,000",
    xField: "pfm_score",
    yField: "physicians_per_10k",
    xFormat: (v) => v.toFixed(2),
    yFormat: (v) => v.toFixed(1),
    note: "Do countries with stronger budget execution systems have more physicians?",
  },
  {
    id: "pfm-nurses",
    from: "pfm",
    to: "workforce",
    xLabel: "PCBE pillar score (0–4)",
    yLabel: "Nurses & midwives per 10,000",
    xField: "pfm_score",
    yField: "nurses_per_10k",
    xFormat: (v) => v.toFixed(2),
    yFormat: (v) => v.toFixed(1),
    note: "Nursing workforce as a downstream signal of budget quality.",
  },
  {
    id: "workforce-coverage",
    from: "workforce",
    to: "coverage",
    xLabel: "Physicians per 10,000",
    yLabel: "Skilled birth attendance (%)",
    xField: "physicians_per_10k",
    yField: "skilled_birth_pct",
    xFormat: (v) => v.toFixed(1),
    yFormat: (v) => `${v.toFixed(0)}%`,
    note: "More health workers → more births attended by skilled personnel.",
  },
  {
    id: "coverage-outcomes",
    from: "coverage",
    to: "outcomes",
    xLabel: "DTP3 immunisation coverage (%)",
    yLabel: "Under-5 mortality rate (per 1,000)",
    xField: "dtp3_coverage",
    yField: "u5mr",
    xFormat: (v) => `${v.toFixed(0)}%`,
    yFormat: (v) => v.toFixed(1),
    note: "Higher vaccine coverage is associated with lower child mortality.",
  },
];

const NODE_LABELS: Record<NodeKey, { label: string; colour: string; description: string }> = {
  pfm:       { label: "Budget execution quality", colour: "#2563eb", description: "PEFA Predictability & Control in Budget Execution (pillar 3)" },
  workforce: { label: "Health workforce",  colour: "#7c3aed", description: "Physicians and nurses per 10,000 population (WHO HWF)" },
  coverage:  { label: "Service coverage",  colour: "#0891b2", description: "DTP3 immunisation coverage, skilled birth attendance (WUENIC / WHO GHO)" },
  outcomes:  { label: "Health outcomes",   colour: "#dc2626", description: "Under-5 mortality rate (IHME / World Bank WDI)" },
};

// ─── Pearson r ────────────────────────────────────────────────────────────────

function pearsonR(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 5) return null;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0, varX = 0, varY = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx, dy = y - my;
    num += dx * dy; varX += dx * dx; varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? null : num / denom;
}

function rLabel(r: number | null, n: number): string {
  if (r === null || n < 5) return "r = n/a";
  const sign = r >= 0 ? "+" : "";
  return `r = ${sign}${r.toFixed(2)}, n = ${n}`;
}

// ─── scatter builder ──────────────────────────────────────────────────────────

function buildScatterTraces(points: PfmChainPoint[], link: LinkDef): Data[] {
  return INCOME_GROUP_ORDER.map((group) => {
    const pts = points.filter((p) => {
      const x = p[link.xField] as number | null;
      const y = p[link.yField] as number | null;
      return x !== null && y !== null && (p.income_group || "Not classified") === group;
    });
    return {
      x: pts.map((p) => p[link.xField] as number),
      y: pts.map((p) => p[link.yField] as number),
      text: pts.map((p) => p.country_name),
      type: "scatter" as const,
      mode: "markers" as const,
      name: group,
      marker: {
        color: INCOME_GROUP_COLORS[group] || "#9ca3af",
        size: 7,
        opacity: 0.65,
      },
      hovertemplate:
        "<b>%{text}</b><br>" +
        `${link.xLabel}: %{x}<br>` +
        `${link.yLabel}: %{y}<br>` +
        "<extra>%{fullData.name}</extra>",
    } as Data;
  });
}

// ─── ScatterPanel ─────────────────────────────────────────────────────────────

function ScatterPanel({
  link,
  points,
}: {
  link: LinkDef;
  points: PfmChainPoint[];
}) {
  const validPairs = useMemo<Array<[number, number]>>(() => {
    return points.flatMap((p) => {
      const x = p[link.xField] as number | null;
      const y = p[link.yField] as number | null;
      return x !== null && y !== null ? [[x, y] as [number, number]] : [];
    });
  }, [points, link]);

  const r = useMemo(() => pearsonR(validPairs), [validPairs]);
  const traces = useMemo(() => buildScatterTraces(points, link), [points, link]);
  const fromNode = NODE_LABELS[link.from];
  const toNode = NODE_LABELS[link.to];

  return (
    <div className="rounded-lg border bg-card p-4">
      {/* Header row */}
      <div className="mb-3 flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
          <span
            className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
            style={{ background: fromNode.colour }}
          >
            {fromNode.label}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span
            className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
            style={{ background: toNode.colour }}
          >
            {toNode.label}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {rLabel(r, validPairs.length)}
        </span>
      </div>
      {link.note && (
        <p className="mb-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {link.note}
        </p>
      )}
      {validPairs.length < 5 ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          Insufficient data — run the pipeline to load {link.yLabel.split(" ")[0]} data.
        </div>
      ) : (
        <PlotlyChart
          className="h-60"
          data={traces}
          layout={{
            xaxis: { title: { text: link.xLabel }, zeroline: false },
            yaxis: { title: { text: link.yLabel }, zeroline: false },
            margin: { l: 52, r: 12, t: 8, b: 44 },
            showlegend: false,
            hovermode: "closest" as const,
          }}
        />
      )}
    </div>
  );
}

// ─── Chain flow diagram ───────────────────────────────────────────────────────

function ChainDiagram() {
  const nodes: NodeKey[] = ["pfm", "workforce", "coverage", "outcomes"];
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center gap-0">
      {nodes.map((key, i) => {
        const node = NODE_LABELS[key];
        return (
          <div key={key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className="flex h-10 w-28 items-center justify-center rounded-lg text-[11px] font-semibold text-white shadow-sm"
                style={{ background: node.colour }}
              >
                {node.label}
              </div>
            </div>
            {i < nodes.length - 1 && (
              <ArrowRight className="mx-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── CoverageInfo ─────────────────────────────────────────────────────────────

function DataCoverageRow({ points }: { points: PfmChainPoint[] }) {
  const stats = useMemo(() => {
    const n = points.length;
    const hasPhys  = points.filter((p) => p.physicians_per_10k !== null).length;
    const hasNurse = points.filter((p) => p.nurses_per_10k !== null).length;
    const hasAnc4  = points.filter((p) => p.anc4_coverage !== null).length;
    const hasSba   = points.filter((p) => p.skilled_birth_pct !== null).length;
    const hasDtp3  = points.filter((p) => p.dtp3_coverage !== null).length;
    const hasU5mr  = points.filter((p) => p.u5mr !== null).length;
    return { n, hasPhys, hasNurse, hasAnc4, hasSba, hasDtp3, hasU5mr };
  }, [points]);

  const items = [
    { label: "Physicians /10k", n: stats.hasPhys },
    { label: "Nurses /10k", n: stats.hasNurse },
    { label: "ANC ≥4 visits", n: stats.hasAnc4 },
    { label: "Skilled birth", n: stats.hasSba },
    { label: "DTP3 coverage", n: stats.hasDtp3 },
    { label: "U5MR", n: stats.hasU5mr },
  ];

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Data coverage across {stats.n} PEFA-assessed countries
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map(({ label, n }) => (
          <span key={label} className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{n}</span> / {stats.n} — {label}
          </span>
        ))}
      </div>
      {(stats.hasAnc4 === 0 || stats.hasSba === 0) && (
        <p className="mt-2 text-[11px] text-amber-600">
          ⚠ ANC ≥4 and skilled birth data require a pipeline re-run after config.py was updated.
        </p>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function PfmChainView() {
  const { conn } = useDuckDB();
  const [points, setPoints] = useState<PfmChainPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [martsAvailable, setMartsAvailable] = useState<boolean | null>(null);
  const [ssaOnly, setSsaOnly] = useState(false);

  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const available = await pfmMartsAvailable(conn);
        if (cancelled) return;
        setMartsAvailable(available);
        if (!available) { setIsLoading(false); return; }
        const data = await getPfmChainData(conn, { ssaOnly });
        if (!cancelled) setPoints(data);
      } catch (err) {
        console.error("PFM chain query failed:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conn, ssaOnly]);

  const handleSsaToggle = useCallback(() => setSsaOnly((v) => !v), []);

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 md:py-10">
        {/* Header */}
        <section>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            PFM &amp; Health · Mediation chain
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
            From public budgets to health outcomes
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Budget execution quality affects outcomes through service-delivery pathways.
            Stronger budget execution supports a larger health workforce, which enables
            broader service coverage, which ultimately drives down mortality. Each scatter
            below shows one link in that chain — correlations are not causal estimates.
          </p>
        </section>

        {/* Flow diagram */}
        <ChainDiagram />

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSsaToggle}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              ssaOnly
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "border-input bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {ssaOnly ? "Sub-Saharan Africa only" : "All countries"}
          </button>
          <span className="text-xs text-muted-foreground">
            {points.length} countries with PEFA data
          </span>
        </div>

        {/* Loading / unavailable states */}
        {(martsAvailable === null || isLoading) && (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
          </div>
        )}

        {martsAvailable === false && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">PFM data not available.</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Run the pipeline to ingest PEFA assessments first.
            </p>
          </div>
        )}

        {martsAvailable && !isLoading && (
          <>
            {/* Data coverage row */}
            <DataCoverageRow points={points} />

            {/* Scatter panels — 2×2 grid */}
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Chain link scatters
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {CHAIN_LINKS.map((link) => (
                  <ScatterPanel key={link.id} link={link} points={points} />
                ))}
              </div>
            </section>

            {/* Source legend */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              {(["pfm", "workforce", "coverage", "outcomes"] as NodeKey[]).map((key) => {
                const node = NODE_LABELS[key];
                return (
                  <div key={key} className="rounded-lg border bg-card p-3">
                    <div
                      className="mb-1.5 h-1 w-8 rounded-full"
                      style={{ background: node.colour }}
                    />
                    <p className="text-[11px] font-semibold">{node.label}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug">
                      {node.description}
                    </p>
                  </div>
                );
              })}
            </section>

            {/* Methodological note */}
            <section className="rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Methodological notes</p>
              <p>
                Each country appears once, using its latest year where the PEFA PCBE pillar score is present
                (carry-forward window: 4 years). Other indicators are matched to the same year where available.
              </p>
              <p>
                Pearson r is a descriptive statistic across countries, not a causal estimate.
                Confounders (income level, geography, governance) are not controlled for.
                Colour encodes World Bank income group.
              </p>
              <p>
                Workforce data: WHO Global Health Observatory (HWF_0001, HWF_0006).
                Immunisation: WHO/UNICEF WUENIC estimates. ANC ≥4 / skilled birth:
                WHO GHO (WHS4_154, MDG_0000000025) — requires pipeline re-run if missing.
              </p>
            </section>
          </>
        )}
        <Compass />
      </div>
  );
}
