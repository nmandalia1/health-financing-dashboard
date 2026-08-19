"use client";

import { useState } from "react";
import { Syringe } from "lucide-react";
import { useImmunizationData } from "@/hooks/use-immunization-data";
import { ViewHeader } from "@/components/ui/view-header";
import { YearRangePicker } from "@/components/ui/year-range-picker";
import { useYearRange } from "@/lib/year-range-context";
import { filterByYears } from "@/lib/filter-years";
import { KpiRow } from "@/components/kpi/kpi-row";
import { KpiRowSkeleton } from "@/components/kpi/kpi-row-skeleton";
import { KpiCard } from "@/components/kpi/kpi-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DataCoverage } from "@/components/ui/data-coverage";
import { cn } from "@/lib/utils";
import type { Data } from "plotly.js-dist-min";
import type { IndicatorTimeSeries } from "@/lib/types";

const GAVI_BADGE_COLORS: Record<string, string> = {
  "Initial Self-Financing": "bg-rose-100 text-rose-800 border-rose-200",
  "Preparatory Transition": "bg-amber-100 text-amber-800 border-amber-200",
  "Accelerated Transition": "bg-sky-100 text-sky-800 border-sky-200",
  "Fully Self-Financing": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Never eligible": "bg-muted text-muted-foreground border-border",
};

// Antigens shown by default; all others are opt-in
const DEFAULT_VISIBLE_ANTIGENS = new Set(["DTP3", "MCV1", "MCV2"]);

function latestValue(d?: IndicatorTimeSeries[]) {
  return d?.length ? d[d.length - 1].value : null;
}
function latestYear(d?: IndicatorTimeSeries[]) {
  return d?.length ? d[d.length - 1].year : undefined;
}
function previousValue(d?: IndicatorTimeSeries[]) {
  return (d?.length ?? 0) >= 2 ? d![d!.length - 2].value : undefined;
}
function previousYear(d?: IndicatorTimeSeries[]) {
  return (d?.length ?? 0) >= 2 ? d![d!.length - 2].year : undefined;
}

/** Scale a decimal-valued series (0–1) to percentage points (0–100). */
function toPercent(series: IndicatorTimeSeries[]): IndicatorTimeSeries[] {
  return series.map((d) => ({ ...d, value: d.value * 100 }));
}

export function ImmunizationView({ iso3 }: { iso3: string }) {
  const { data, metadata, isLoading } = useImmunizationData(iso3);
  const { startYear, endYear } = useYearRange();
  const [visibleAntigens, setVisibleAntigens] = useState<Set<string>>(
    () => new Set(DEFAULT_VISIBLE_ANTIGENS)
  );

  const toggleAntigen = (name: string) => {
    setVisibleAntigens((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <ViewHeader
          title="Immunization Financing & Coverage"
          question="Is immunization financing becoming domestically sustainable?"
        />
        <KpiRowSkeleton />
        <div className="h-[320px] animate-pulse rounded-lg border bg-muted" />
        <div className="h-[280px] animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);

  // Financing
  const govtVax = f("WHO_IMM_GOV_VAX_USD");
  const totalVax = f("WHO_IMM_TOT_VAX_USD");
  // WHO_IMM_GOV_SHARE is stored as a decimal (0–1); convert to percentage points
  const govtShare = toPercent(f("WHO_IMM_GOV_SHARE"));

  // Coverage (WUENIC — WHO/UNICEF Estimates of National Immunization Coverage)
  const bcg     = f("WUENIC_BCG");
  const dpt1    = f("WUENIC_DTP1");
  const dpt3    = f("WUENIC_DTP3");
  const mcv1    = f("WUENIC_MCV1");
  const mcv2    = f("WUENIC_MCV2");
  const pcv3    = f("WUENIC_PCV3");
  const rota    = f("WUENIC_ROTAC");
  const hepb    = f("WUENIC_HEPB3");
  const hepbBd  = f("WUENIC_HEPBB");
  const hib3    = f("WUENIC_HIB3");
  const pol3    = f("WUENIC_POL3");
  const ipv1    = f("WUENIC_IPV1");
  const rcv1    = f("WUENIC_RCV1");
  const yfv     = f("WUENIC_YFV");

  const latestDpt      = latestValue(dpt3);
  const latestMcv1     = latestValue(mcv1);
  const latestGovtShare = latestValue(govtShare);
  const latestTotalVax  = latestValue(totalVax);

  const gaviPhase = metadata?.gavi_phase || metadata?.gavi_status || "—";
  const isGaviRelevant = gaviPhase && gaviPhase !== "—" && gaviPhase !== "Never eligible";

  // ── Vaccine spending composition: stacked bars (absolute USD) ───────────────
  // govtVax and totalVax are in USD; external = total - govt
  const spendingYears = totalVax
    .map((t) => {
      const govtPt  = govtVax.find((g) => g.year === t.year);
      const govtAmt = govtPt?.value ?? 0;
      const externalAmt = Math.max(0, t.value - govtAmt);
      return { year: t.year, govt: govtAmt, external: externalAmt, total: t.value };
    })
    .filter((d) => d.total > 0);

  const spendingTracesStacked: Data[] = spendingYears.length > 0
    ? [
        {
          type: "bar",
          x: spendingYears.map((d) => d.year),
          y: spendingYears.map((d) => d.govt),
          name: "Government",
          marker: { color: "#2563eb" },
          hovertemplate: "%{x}: $%{y:,.0f} govt<extra></extra>",
        },
        {
          type: "bar",
          x: spendingYears.map((d) => d.year),
          y: spendingYears.map((d) => d.external),
          name: "External / Donor",
          marker: { color: "#0d9488" },
          hovertemplate: "%{x}: $%{y:,.0f} external<extra></extra>",
        },
      ]
    : [];

  // ── Hero chart: govt share (%) vs DPT3 coverage (%) ────────────────────────
  const heroTraces: Data[] = [];
  if (govtShare.length > 0) {
    heroTraces.push({
      type: "scatter",
      mode: "lines",
      x: govtShare.map((d) => d.year),
      y: govtShare.map((d) => d.value),
      name: "Govt share of vaccine spending",
      fill: "tozeroy",
      fillcolor: "rgba(37, 99, 235, 0.15)",
      line: { color: "#2563eb", width: 2 },
      yaxis: "y",
      hovertemplate: "%{x}: %{y:.1f}% govt-financed<extra></extra>",
    });
  }
  if (dpt3.length > 0) {
    heroTraces.push({
      type: "scatter",
      mode: "lines+markers",
      x: dpt3.map((d) => d.year),
      y: dpt3.map((d) => d.value),
      name: "DPT3 coverage",
      line: { color: "#dc2626", width: 2 },
      marker: { size: 5 },
      yaxis: "y2",
      hovertemplate: "%{x}: %{y:.0f}% DPT3<extra></extra>",
    });
  }

  // ── All antigens definition (ordered: priority first, then alphabetical) ────
  const ALL_ANTIGENS: Array<{
    name: string;
    data: IndicatorTimeSeries[];
    color: string;
    priority?: boolean;
  }> = [
    { name: "DTP3",           data: dpt3,   color: "#dc2626", priority: true },
    { name: "MCV1",           data: mcv1,   color: "#ea580c", priority: true },
    { name: "MCV2",           data: mcv2,   color: "#f59e0b", priority: true },
    { name: "BCG",            data: bcg,    color: "#14532d" },
    { name: "DTP1",           data: dpt1,   color: "#b91c1c" },
    { name: "Polio3",         data: pol3,   color: "#4b5563" },
    { name: "IPV1",           data: ipv1,   color: "#334155" },
    { name: "PCV3",           data: pcv3,   color: "#0d9488" },
    { name: "Hib3",           data: hib3,   color: "#059669" },
    { name: "Rotavirus",      data: rota,   color: "#7c3aed" },
    { name: "HepB3",          data: hepb,   color: "#2563eb" },
    { name: "HepB birth-dose",data: hepbBd, color: "#1e3a8a" },
    { name: "RCV1 (Rubella)", data: rcv1,   color: "#be185d" },
    { name: "Yellow Fever",   data: yfv,    color: "#ca8a04" },
  ];

  // Only include antigens that actually have data for this country
  const availableAntigens = ALL_ANTIGENS.filter((a) => a.data.length > 0);

  const visibleLines = availableAntigens
    .filter((a) => visibleAntigens.has(a.name))
    .map((a) => ({
      name: a.name,
      data: a.data,
      color: a.color,
      hoverValue: "%{y:.0f}%",
    }));

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Immunization Financing & Coverage"
        question="Are countries financing their own immunization programs?"
      >
        <YearRangePicker />
        {gaviPhase && gaviPhase !== "—" && (
          <div
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              GAVI_BADGE_COLORS[gaviPhase] ??
              "bg-muted text-muted-foreground border-border"
            }`}
          >
            <Syringe className="h-3 w-3" />
            GAVI: {gaviPhase}
          </div>
        )}
      </ViewHeader>

      {/* KPIs */}
      <KpiRow>
        <KpiCard
          label="Government share of routine vaccine spending"
          value={latestGovtShare}
          unit="%"
          previousValue={previousValue(govtShare)}
          year={latestYear(govtShare)}
          previousYear={previousYear(govtShare)}
          source="WHO Immunization"
          colorClass="text-[#2563eb]"
          info={{
            title: "Government share of routine vaccine spending (%)",
            description:
              "Proportion of total routine vaccine spending financed by the national government, as opposed to external partners, including Gavi co-financing.",
            source: "WHO / UNICEF Joint Reporting Form (JRF)",
            interpretation:
              "An increasing government share over time is a core indicator of immunization programme sustainability. It reflects the country's fiscal commitment to maintaining vaccination as domestic financing replaces donor support.",
          }}
        />
        <KpiCard
          label="Routine vaccine spending (US$)"
          value={latestTotalVax}
          unit="$"
          previousValue={previousValue(totalVax)}
          year={latestYear(totalVax)}
          previousYear={previousYear(totalVax)}
          source="WHO Immunization"
          info={{
            title: "Total Routine Vaccine Expenditure (current USD)",
            description:
              "Annual aggregate spending on routine vaccines, combining government and external donor contributions, expressed in current US dollars.",
            source: "WHO / UNICEF Joint Reporting Form (JRF)",
            interpretation:
              "Total expenditure reflects the scale of national immunization financing. The composition between government and external sources indicates dependency on donor funding.",
          }}
        />
        <KpiCard
          label="DPT3 Immunization Coverage (%)"
          value={latestDpt}
          unit="%"
          previousValue={previousValue(dpt3)}
          year={latestYear(dpt3)}
          previousYear={previousYear(dpt3)}
          source="WHO/UNICEF (WUENIC)"
          colorClass={
            latestDpt === null
              ? undefined
              : latestDpt >= 90
                ? "text-emerald-600"
                : latestDpt >= 80
                  ? "text-amber-600"
                  : "text-red-600"
          }
          info={{
            title: "DPT3 Immunization Coverage (% of surviving infants)",
            description:
              "Proportion of surviving infants who received three doses of diphtheria-tetanus-pertussis-containing vaccine during the first year of life.",
            source: "WHO/UNICEF Estimates of National Immunization Coverage (WUENIC)",
            interpretation:
              "DTP3 is the headline indicator of routine immunization system performance. The global coverage target is at least 90% nationally, with high and equitable subnational coverage also needed. It also proxies delivery system strength for other multi-dose vaccines.",
            referenceUrl: "https://immunizationdata.who.int/",
          }}
        />
        <KpiCard
          label="Measles MCV1 Coverage (%)"
          value={latestMcv1}
          unit="%"
          previousValue={previousValue(mcv1)}
          year={latestYear(mcv1)}
          previousYear={previousYear(mcv1)}
          source="WHO/UNICEF (WUENIC)"
          colorClass={
            latestMcv1 === null
              ? undefined
              : latestMcv1 >= 95
                ? "text-emerald-600"
                : latestMcv1 >= 90
                  ? "text-amber-600"
                  : "text-red-600"
          }
          info={{
            title: "Measles First-Dose (MCV1) Coverage (% of surviving infants)",
            description:
              "Proportion of surviving infants who received the first dose of a measles-containing vaccine.",
            source: "WHO/UNICEF Estimates of National Immunization Coverage (WUENIC)",
            interpretation:
              "Measles control requires very high coverage, usually at least 95% with both doses, because measles is highly transmissible. Coverage below 90% is associated with sustained outbreak risk.",
          }}
        />
      </KpiRow>

      {/* Vaccine spending composition — stacked absolute USD */}
      {spendingTracesStacked.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  Routine Vaccine Expenditure by Financing Source (USD)
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Government and external financing shown as components of total routine vaccine spending.
                </p>
              </div>
              <InfoTooltip
                title="Routine Vaccine Expenditure by Financing Source (current USD)"
                description="Annual routine vaccine spending decomposed by source: government-financed and external/donor contributions. Total expenditure equals government expenditure plus external co-financing."
                source="WHO / UNICEF Joint Reporting Form (JRF)"
                interpretation="The relative height of each segment shows how much of total vaccine spending is domestically financed versus externally supported. A growing government share relative to total indicates increasing fiscal self-sufficiency."
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              WHO Immunization
            </span>
          </div>
          <div className="h-[300px]">
            <PlotlyChart
              className="h-full"
              data={spendingTracesStacked}
              layout={{
                barmode: "stack" as const,
                hovermode: "x unified" as const,
                yaxis: { title: { text: "USD" }, tickprefix: "$" },
                xaxis: { title: { text: "Year" } },
              }}
            />
          </div>
          <DataCoverage series={[govtVax, totalVax]} />
        </div>
      )}

      {/* Hero: govt share (%) vs DPT3 coverage (%) */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">
                Government Share of Vaccine Spending vs. DPT3 Coverage
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                Blue area = government share of vaccine spending (%) · red line = DPT3 coverage (right axis)
              </p>
            </div>
            <InfoTooltip
              title="Government Share of Vaccine Spending vs. DPT3 Coverage"
              description="The left axis shows the proportion of total vaccine expenditure financed by government (blue area, %). The right axis shows DPT3 immunization coverage over the same period."
              source="WHO / UNICEF Joint Reporting Form (JRF); WUENIC"
              interpretation="Tracking these two indicators together reveals whether increases in domestic financing are associated with maintained or improved coverage. A rising government share without coverage decline indicates a successful financing transition."
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            WHO / UNICEF
          </span>
        </div>
        {heroTraces.length > 0 ? (
          <>
            <div className="h-[340px]">
              <PlotlyChart
                className="h-full"
                data={heroTraces}
                layout={{
                  hovermode: "x unified" as const,
                  yaxis: {
                    title: { text: "Govt share (%)" },
                    range: [0, 100],
                    ticksuffix: "%",
                  },
                  yaxis2: {
                    title: { text: "DPT3 coverage (%)" },
                    range: [0, 100],
                    overlaying: "y",
                    side: "right",
                    ticksuffix: "%",
                    showgrid: false,
                  },
                  shapes: [
                    {
                      type: "line",
                      x0: 0,
                      x1: 1,
                      xref: "paper",
                      y0: 90,
                      y1: 90,
                      yref: "y2",
                      line: { color: "#9ca3af", width: 1.5, dash: "dash" },
                    },
                  ],
                  annotations: [
                    {
                      x: 1,
                      xref: "paper",
                      y: 90,
                      yref: "y2",
                      text: "90% DPT3 target",
                      showarrow: false,
                      xanchor: "right",
                      yanchor: "bottom",
                      font: { size: 11, color: "#6b7280" },
                    },
                  ],
                }}
              />
            </div>
            <DataCoverage series={[govtShare, dpt3]} />
          </>
        ) : (
          <div className="flex h-[280px] items-center justify-center rounded-lg bg-muted/40">
            <p className="text-sm text-muted-foreground">
              No immunization financing or coverage data available.
            </p>
          </div>
        )}
        {isGaviRelevant && (
          <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Syringe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-govt" />
            <span>
              <span className="font-medium text-foreground">
                Gavi transition status:
              </span>{" "}
              This country is in the <em>{gaviPhase}</em> phase. Countries co-finance a growing share of vaccine costs as they progress toward full self-financing upon GAVI graduation.
            </span>
          </div>
        )}
      </div>

      {/* Coverage by antigen — with toggle controls */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">
                Immunization Coverage by Antigen (%)
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                Routine childhood vaccines — WHO/UNICEF estimates · 90% target line
              </p>
            </div>
            <InfoTooltip
              title="Immunization Coverage by Antigen (% of surviving infants)"
              description="Annual national coverage estimates for routine childhood vaccines tracked by WHO/UNICEF. DTP3, MCV1, and MCV2 are shown by default; antigen buttons add or remove series."
              source="WUENIC — WHO/UNICEF Estimates of National Immunization Coverage"
              interpretation="Dropout between DTP1 and DTP3 reflects system-level attrition. Gaps between newly introduced antigens (PCV3, Rotavirus) and established vaccines may reflect programme introduction timelines. Low MCV2 relative to MCV1 indicates weak second-dose delivery."
              referenceUrl="https://immunizationdata.who.int/"
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            WUENIC (WHO/UNICEF)
          </span>
        </div>

        {/* Antigen toggle buttons */}
        {availableAntigens.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {availableAntigens.map((antigen) => {
              const isOn = visibleAntigens.has(antigen.name);
              return (
                <button
                  key={antigen.name}
                  onClick={() => toggleAntigen(antigen.name)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all",
                    isOn
                      ? "border-transparent text-white shadow-sm"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  style={isOn ? { backgroundColor: antigen.color } : undefined}
                >
                  {antigen.priority && (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isOn ? "bg-white/70" : "bg-current opacity-50"
                      )}
                    />
                  )}
                  {antigen.name}
                </button>
              );
            })}
            <button
              onClick={() =>
                setVisibleAntigens(new Set(DEFAULT_VISIBLE_ANTIGENS))
              }
              className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            >
              Reset
            </button>
          </div>
        )}

        <div className="h-[320px]">
          {visibleLines.length > 0 ? (
            <TimeSeriesChart
              className="h-full"
              lines={visibleLines}
              yAxisTitle="Coverage (%)"
              benchmark={{
                value: 90,
                label: "90% target",
                color: "#9ca3af",
                unit: "%",
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg bg-muted/40">
              <p className="text-sm text-muted-foreground">
                Select at least one antigen above to display coverage trends.
              </p>
            </div>
          )}
        </div>
        <DataCoverage series={[dpt3, mcv1, mcv2, bcg].filter((s) => s.length > 0)} />
      </div>
    </div>
  );
}
