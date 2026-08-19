"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getMultipleIndicators, getFiscalComponents } from "@/lib/queries";
import { useFiscalComposites } from "@/hooks/use-fiscal-composites";
import { INDICATOR_REGISTRY, PILLARS, type Indicator } from "@/lib/indicator-registry";
import {
  bandColor,
  scoreVerdict,
  benchmarkLabel,
  formatMetricValue,
  unitSuffix,
  PILLAR_QUESTIONS,
  PILLAR_SHORT,
} from "@/lib/fiscal-scoring";
import { Sparkline } from "@/components/charts/sparkline";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { MetricHoverCard } from "./metric-hover-card";
import type { FiscalComponentRow, IndicatorGroup, IndicatorTimeSeries } from "@/lib/types";

const PILLAR_ORDER = Object.keys(PILLARS);

function indicatorsForPillar(pillarKey: string): Indicator[] {
  return Object.values(INDICATOR_REGISTRY).filter((i) => i.pillars.includes(pillarKey));
}

function latestOf(series?: IndicatorTimeSeries[]): IndicatorTimeSeries | null {
  return series && series.length ? series[series.length - 1] : null;
}

/** Loads the country's time series for a set of indicator codes. */
function useIndicatorGroup(iso3: string, codes: string[]) {
  const { conn } = useDuckDB();
  const [group, setGroup] = useState<IndicatorGroup>({});
  const [isLoading, setIsLoading] = useState(true);
  const key = codes.join(",");
  useEffect(() => {
    if (!conn || codes.length === 0) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    getMultipleIndicators(conn, iso3, codes)
      .then(setGroup)
      .catch((e) => console.error("Pillar indicator query failed:", e))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, iso3, key]);
  return { group, isLoading };
}

/** Loads the per-indicator component scores for one pillar + year. */
function usePillarComponents(iso3: string, pillar: string, year: number | undefined) {
  const { conn } = useDuckDB();
  const [comps, setComps] = useState<FiscalComponentRow[]>([]);
  useEffect(() => {
    if (!conn || year == null) return;
    getFiscalComponents(conn, iso3, pillar, year)
      .then(setComps)
      .catch((e) => console.error("Pillar components query failed:", e));
  }, [conn, iso3, pillar, year]);
  return comps;
}

function componentLabel(code: string): string {
  if (code === "_outcome_attainment") return "Outcome attainment";
  if (code === "_spend_level") return "Spending level";
  return INDICATOR_REGISTRY[code]?.label ?? code;
}

/**
 * "How this score is built" — each component indicator's peer-normalised 0–100
 * score, which average to the pillar sub-index. Efficiency is special-cased: it
 * shows the proxy's two parts (attainment vs spending) and the gap rule.
 */
function ScoreBreakdown({
  pillarKey,
  comps,
  score,
  group,
}: {
  pillarKey: string;
  comps: FiscalComponentRow[];
  score: number | null;
  group: IndicatorGroup;
}) {
  const isEfficiency = pillarKey === "efficiency";
  const att = comps.find((c) => c.code === "_outcome_attainment")?.norm_score ?? null;
  const spend = comps.find((c) => c.code === "_spend_level")?.norm_score ?? null;

  // A bar, optionally wrapped in a hover card revealing the underlying data.
  const Bar = ({ label, value, code }: { label: string; value: number; code?: string }) => {
    const ind = code ? INDICATOR_REGISTRY[code] : undefined;
    const row = (
      <div className="flex w-full items-center gap-2.5">
        <span className="w-36 shrink-0 truncate text-[11px] text-muted-foreground" title={label}>
          {label}
        </span>
        <div className="relative h-2.5 flex-1 rounded-full bg-muted">
          <div className="absolute left-0 top-0 h-2.5 rounded-full"
               style={{ width: `${value}%`, background: bandColor(value) }} />
        </div>
        <span className="w-6 shrink-0 text-right text-[11px] font-medium tabular-nums">
          {Math.round(value)}
        </span>
      </div>
    );
    if (!ind) {
      // Pseudo-component (attainment / spend) — explain rather than chart.
      return (
        <MetricHoverCard
          className="block w-full"
          label={label}
          score={value}
          source="composite of WHO/World Bank outcomes"
          interpretation={
            code === "_outcome_attainment"
              ? "Composite of life expectancy, under-5 and maternal survival, and UHC coverage — each scored 0–100 vs peers, then averaged."
              : "Government health spending per capita, scored 0–100 vs peers. Lower spend for the same outcomes = higher efficiency."
          }
        >
          {row}
        </MetricHoverCard>
      );
    }
    return (
      <MetricHoverCard
        className="block w-full"
        label={ind.label}
        source={ind.source}
        unit={ind.unit}
        series={code ? group[code] : undefined}
        score={value}
        direction={ind.direction}
        benchmarks={ind.benchmarks}
        interpretation={ind.interpretation}
      >
        {row}
      </MetricHoverCard>
    );
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-start gap-1.5">
        <h2 className="text-sm font-medium text-muted-foreground">How this score is built</h2>
        <InfoTooltip
          title="How the sub-index is built"
          description={
            isEfficiency
              ? "Efficiency compares health outcomes with spending levels among peer countries. It is a proxy, not a causal efficiency estimate. Score = 50 + (attainment − spending) / 2."
              : "Each indicator is converted so a higher score means more fiscal space relative to peers. The pillar sub-index is their average."
          }
          source="mart_fiscal_space components"
          interpretation="Bars to the right of the average pull the score up; bars to the left pull it down."
        />
      </div>

      {isEfficiency ? (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Outcomes achieved vs spending level (0–100 vs peers). A bigger
            outcomes-over-spending gap means better value for money.
          </p>
          {att != null && <Bar label="Outcome attainment" value={att} code="_outcome_attainment" />}
          {spend != null && <Bar label="Spending level" value={spend} code="_spend_level" />}
          {att != null && spend != null && score != null && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              50 + ({Math.round(att)} − {Math.round(spend)}) / 2 ={" "}
              <span className="font-medium text-foreground">{Math.round(score)}</span>
            </p>
          )}
        </div>
      ) : comps.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No component data for this year.</p>
      ) : (
        <div className="relative space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Average of {comps.length} indicator{comps.length > 1 ? "s" : ""}, each scored 0–100 vs peers:
          </p>
          {comps.map((c) => (
            <Bar key={c.code} label={componentLabel(c.code)} value={c.norm_score} code={c.code} />
          ))}
          {score != null && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              average ={" "}
              <span className="font-medium text-foreground">{Math.round(score)}</span> · the sub-index
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PillarView({ iso3, pillarKey }: { iso3: string; pillarKey: string }) {
  const { latest, series, peerMedians, incomeGroup } = useFiscalComposites(iso3);

  const indicators = indicatorsForPillar(pillarKey);
  const codes = indicators.filter((i) => i.available).map((i) => i.code);
  const { group } = useIndicatorGroup(iso3, codes);
  const comps = usePillarComponents(iso3, pillarKey, latest?.year);
  const compScore: Record<string, number> = Object.fromEntries(
    comps.map((c) => [c.code, c.norm_score])
  );

  // Deep-link from the navigator's Indicators lane (#ind-<code>): scroll to the
  // catalogue card and flash it. Re-runs when the catalogue data arrives.
  useEffect(() => {
    function jump() {
      const h = window.location.hash;
      if (!h.startsWith("#ind-")) return;
      const el = document.getElementById(h.slice(1));
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-blue-400");
      window.setTimeout(() => el.classList.remove("ring-2", "ring-blue-400"), 1600);
    }
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const label = PILLARS[pillarKey as keyof typeof PILLARS];
  const pillarIndex = PILLAR_ORDER.indexOf(pillarKey);
  const score = latest?.[`pillar_${pillarKey}_score`] ?? null;
  const peer = peerMedians?.[`pillar_${pillarKey}_score`] ?? null;
  const coverage = latest?.[`pillar_${pillarKey}_coverage`] ?? null;
  const verdict = score != null ? scoreVerdict(score) : null;

  // Pillar sub-index trend.
  const trend: IndicatorTimeSeries[] = series
    .map((r) => ({ year: r.year, value: r[`pillar_${pillarKey}_score`] }))
    .filter((d): d is IndicatorTimeSeries => d.value != null);

  // Named composite cards specific to this pillar.
  const derived: Array<{ label: string; value: string; note: string }> = [];
  if (pillarKey === "debt" && latest?.crowding_out_ratio != null) {
    const r = latest.crowding_out_ratio;
    derived.push({
      label: "Debt service vs health spending",
      value: `${r.toFixed(2)}×`,
      note:
        r >= 1
          ? `External debt service costs ${r.toFixed(1)}× as much as public health spending.`
          : `Public health spending is ${(1 / r).toFixed(1)}× external debt service.`,
    });
  }
  if (pillarKey === "external" && latest?.transition_risk_score != null) {
    derived.push({
      label: "Donor transition risk",
      value: `${Math.round(latest.transition_risk_score)} / 100`,
      note: "Higher = more reliant on donor funding, so more exposed if aid falls. Scored 0–100 vs peers (proxy).",
    });
  }

  // Core charts: the pillar's primary (domain) indicators that have data.
  const coreCharts = indicators
    .filter((i) => i.domain === pillarKey && i.available && (group[i.code]?.length ?? 0) > 1)
    .slice(0, 2);

  return (
    <div className="space-y-6">
      {/* Zone 1 — header (layout supplies the breadcrumb above this) */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">{label}</h1>
          <span className="shrink-0 text-xs text-muted-foreground">
            Pillar {pillarIndex + 1} of 7 · contributes{" "}
            <span className="font-medium text-foreground">1 of 7</span> to the index
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{PILLAR_QUESTIONS[pillarKey]}</p>
      </div>

      {/* Zone 2 — sub-index hero + how it's built */}
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center rounded-lg border bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground">pillar sub-index</p>
          <MetricHoverCard
            className="inline-flex cursor-help"
            align="left"
            label={`${label} sub-index`}
            valueOverride={`${score != null ? Math.round(score) : "—"} / 100`}
            series={trend}
            score={score}
            direction={1}
            interpretation={`Average of this pillar's indicators, each scored 0–100 against ${
              incomeGroup ?? "peers"
            }. Peer median ${peer != null ? Math.round(peer) : "—"}; ${
              coverage != null ? Math.round(coverage * 100) : "—"
            }% of the pillar's indicators have data. Hover a bar in "How this score is built" to inspect each one.`}
          >
            <span className="mt-1 text-4xl font-medium leading-none"
                  style={{ color: bandColor(score) }}>
              {score != null ? Math.round(score) : "—"}
            </span>
          </MetricHoverCard>
          <span className="mt-0.5 text-[10px] text-muted-foreground/70">
            0–100, scored vs {incomeGroup ?? "peers"}
          </span>
          {verdict && <span className={`mt-2 text-xs font-medium ${verdict.tone}`}>{verdict.label}</span>}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {peer != null ? `peer median ${Math.round(peer)}` : ""}
            {coverage != null
              ? `${peer != null ? " · " : ""}${Math.round(coverage * 100)}% data coverage`
              : ""}
          </p>
          {trend.length > 1 && (
            <div className="mt-3 w-full">
              <div className="h-[44px]">
                <Sparkline className="h-full" data={trend} color={bandColor(score)}
                           hoverValue="%{y:.0f}" />
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                trend since {trend[0].year}
              </p>
            </div>
          )}
        </div>
        <ScoreBreakdown pillarKey={pillarKey} comps={comps} score={score} group={group} />
      </div>

      {/* Zone 3 — derived / composite indicators */}
      {derived.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Derived &amp; composite indicators</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {derived.map((d) => (
              <div key={d.label} className="rounded-md bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{d.label}</p>
                <p className="mt-1 text-2xl font-medium">{d.value}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{d.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zone 4 — core charts */}
      {coreCharts.map((ind) => {
        const data = group[ind.code] ?? [];
        const benchValues = Object.entries(ind.benchmarks);
        const bench = benchValues.length
          ? { value: benchValues[0][1], label: benchmarkLabel(benchValues[0][0]), unit: "" }
          : undefined;
        return (
          <div key={ind.code} className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">{ind.label}</h2>
              <InfoTooltip title={ind.label} description={ind.interpretation}
                           source={ind.source} interpretation={ind.interpretation}
                           referenceUrl={ind.reference_url || undefined} />
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{ind.source}</span>
            </div>
            <div className="h-[260px]">
              <TimeSeriesChart className="h-full"
                lines={[{ name: ind.label, data, color: "#2563eb", hoverValue: "%{y:.1f}" }]}
                benchmark={bench} yAxisTitle={ind.unit} />
            </div>
          </div>
        );
      })}

      {/* Zone 5 — full indicator catalogue */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            All relevant indicators ({indicators.length})
          </p>
          <span className="text-[11px] text-muted-foreground">indicators shared with other pillars are tagged</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {indicators.map((ind) => {
            const data = group[ind.code] ?? [];
            const latestPoint = latestOf(data);
            const suffix = unitSuffix(ind.unit);
            const alsoIn = ind.pillars.filter((p) => p !== pillarKey);
            // Context = present for understanding but not scored into this
            // pillar's sub-index (income levels, ODA, debt stock, …). On the
            // efficiency page the outcome indicators DO drive the proxy.
            const isContext =
              (ind.normalization === "none" || ind.direction === 0) && pillarKey !== "efficiency";
            return (
              <MetricHoverCard
                key={ind.code}
                id={`ind-${ind.code}`}
                className="block cursor-help"
                label={ind.label}
                source={ind.source}
                unit={ind.unit}
                series={data}
                score={ind.code in compScore ? compScore[ind.code] : null}
                direction={ind.direction}
                benchmarks={ind.benchmarks}
                interpretation={ind.interpretation}
              >
                <div className="w-full rounded-md border bg-card p-3 transition-colors hover:border-foreground/20">
                  <p className="text-xs leading-snug text-muted-foreground">{ind.label}</p>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      {!ind.available ? (
                        <span className="text-sm text-muted-foreground">not yet sourced</span>
                      ) : latestPoint ? (
                        <>
                          <span className="text-lg font-medium tabular-nums">
                            {formatMetricValue(latestPoint.value, ind.unit)}
                          </span>
                          {suffix && (
                            <span className="ml-1 text-[11px] text-muted-foreground">{suffix}</span>
                          )}
                          <div className="text-[10px] text-muted-foreground/70">{latestPoint.year}</div>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">no data</span>
                      )}
                    </div>
                    <div className="h-7 w-24 shrink-0">
                      {data.length > 1 && (
                        <Sparkline className="h-full" data={data} color="#6b7280" />
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground/70">{ind.source}</span>
                    {isContext && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
                        context
                      </span>
                    )}
                    {alsoIn.map((p) => (
                      <span key={p}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        also in {PILLAR_SHORT[p] ?? p}
                      </span>
                    ))}
                  </div>
                </div>
              </MetricHoverCard>
            );
          })}
        </div>
      </div>
    </div>
  );
}
