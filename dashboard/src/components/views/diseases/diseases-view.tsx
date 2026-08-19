"use client";

import { useDiseaseData } from "@/hooks/use-disease-data";
import { ViewHeader } from "@/components/ui/view-header";
import { YearRangePicker } from "@/components/ui/year-range-picker";
import { useYearRange } from "@/lib/year-range-context";
import { filterByYears } from "@/lib/filter-years";
import { KpiRow } from "@/components/kpi/kpi-row";
import { KpiRowSkeleton } from "@/components/kpi/kpi-row-skeleton";
import { KpiCard } from "@/components/kpi/kpi-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { DataCoverage } from "@/components/ui/data-coverage";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { NoData } from "@/components/ui/no-data";
import type { IndicatorGroup, IndicatorTimeSeries } from "@/lib/types";

export type Disease = "hiv" | "tb" | "malaria" | "ncds";


function getLatest(d?: IndicatorTimeSeries[]) {
  return d?.length ? d[d.length - 1].value : null;
}
function getLatestYear(d?: IndicatorTimeSeries[]) {
  return d?.length ? d[d.length - 1].year : undefined;
}
function getPrevious(d?: IndicatorTimeSeries[]) {
  return (d?.length ?? 0) >= 2 ? d![d!.length - 2].value : undefined;
}
function getPreviousYear(d?: IndicatorTimeSeries[]) {
  return (d?.length ?? 0) >= 2 ? d![d!.length - 2].year : undefined;
}
function hasAny(...series: Array<IndicatorTimeSeries[] | undefined>) {
  return series.some((s) => (s?.length ?? 0) > 0);
}

export function DiseasesView({
  iso3,
  active,
}: {
  iso3: string;
  active: Disease;
}) {
  const { data, isLoading } = useDiseaseData(iso3);
  const { startYear, endYear } = useYearRange();

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <ViewHeader
          title="Disease-Specific Financing & Burden"
          question="Do disease financing and service coverage match the burden?"
        />
        <div className="h-10 w-full max-w-md animate-pulse rounded-md bg-muted" />
        <KpiRowSkeleton />
        <div className="h-[280px] animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);
  const external = f("GHED_EXTCHE_SHA2011");

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Disease-Specific Financing & Burden"
        question="Are disease-specific investments matching the burden?"
      >
        <YearRangePicker />
      </ViewHeader>

      {active === "hiv" && <HivPanel data={data} external={external} />}
      {active === "tb" && <TbPanel data={data} external={external} />}
      {active === "malaria" && <MalariaPanel data={data} external={external} />}
      {active === "ncds" && <NcdPanel data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HIV Panel
// ---------------------------------------------------------------------------

function HivPanel({
  data,
  external,
}: {
  data: IndicatorGroup;
  external: IndicatorTimeSeries[];
}) {
  const { startYear, endYear } = useYearRange();
  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);

  // UNAIDS — primary source for all HIV epidemiology
  const plhiv         = f("UNAIDS_PLHIV");
  const newInfections = f("UNAIDS_NEW_INFECTIONS");
  const aidsDeaths    = f("UNAIDS_AIDS_DEATHS");
  const prevalence    = f("UNAIDS_PREVALENCE_ADULTS");
  const incidenceRate = f("UNAIDS_INCIDENCE_RATE");
  const artCoverage   = f("UNAIDS_ART_COVERAGE");

  // UNAIDS — 95-95-95 cascade
  const diagnosed  = f("UNAIDS_95_DIAGNOSED");
  const onArt      = f("UNAIDS_95_ON_ART");
  const suppressed = f("UNAIDS_95_SUPPRESSED");

  // UNAIDS — PMTCT
  const pmtct = f("UNAIDS_PMTCT");

  // UNAIDS — financing (Total = Gov + Private + International)
  const finTotal         = f("UNAIDS_FIN_TOTAL");
  const finDomesticGov   = f("UNAIDS_FIN_DOMESTIC_GOV");
  const finDomesticPriv  = f("UNAIDS_FIN_DOMESTIC_PRIV");
  const finInternational = f("UNAIDS_FIN_INTERNATIONAL");
  const finGlobalFund    = f("UNAIDS_FIN_GLOBAL_FUND");
  const finPepfar        = f("UNAIDS_FIN_PEPFAR");

  // Fallback to WHO GHO / World Bank only if UNAIDS has no data for this country
  const incidenceFallback = f("MDG_0000000020");
  const artFallback       = f("SH.HIV.ARTC.ZS");
  const deathsFallback    = f("HIV_0000000006");

  const incidence = incidenceRate.length > 0 ? incidenceRate : incidenceFallback;
  const art       = artCoverage.length > 0   ? artCoverage   : artFallback;
  const deaths    = aidsDeaths.length > 0    ? aidsDeaths    : deathsFallback;

  const hasUnaids = hasAny(plhiv, newInfections, aidsDeaths, diagnosed, onArt, suppressed);
  const hasFinancing = hasAny(finTotal, finDomesticGov, finInternational);

  // Derive "Other international" = International − Global Fund − PEPFAR
  const gfByYear     = new Map(finGlobalFund.map((d) => [d.year, d.value]));
  const pepfarByYear = new Map(finPepfar.map((d) => [d.year, d.value]));
  const intlByYear   = new Map(finInternational.map((d) => [d.year, d.value]));
  const finOtherIntl = finInternational
    .map((d) => ({
      ...d,
      value: d.value - (gfByYear.get(d.year) ?? 0) - (pepfarByYear.get(d.year) ?? 0),
    }))
    .filter((d) => d.value > 1);

  // Per-year totals for tooltip customdata (financing flows chart)
  const govByYear2  = new Map(finDomesticGov.map((d) => [d.year, d.value]));
  const privByYear2 = new Map(finDomesticPriv.map((d) => [d.year, d.value]));
  const flowsYears  = [...new Set([
    ...finDomesticGov.map((d) => d.year),
    ...finDomesticPriv.map((d) => d.year),
    ...finInternational.map((d) => d.year),
  ])].sort((a, b) => a - b);
  const flowsTotByYear = new Map(
    flowsYears.map((y) => [
      y,
      (govByYear2.get(y) ?? 0) + (privByYear2.get(y) ?? 0) + (intlByYear.get(y) ?? 0),
    ]),
  );

  if (!hasAny(plhiv, newInfections, prevalence, incidence, art)) {
    return (
      <NoData
        label="HIV data"
        hint="This may mean the country is not endemic, or the indicator is not routinely reported to UNAIDS / WHO / World Bank."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ── KPI row: epidemiology ── */}
      <KpiRow>
        <KpiCard
          label="People living with HIV"
          value={getLatest(plhiv)}
          unit=""
          previousValue={getPrevious(plhiv)}
          year={getLatestYear(plhiv)}
          previousYear={getPreviousYear(plhiv)}
          source="UNAIDS"
          info={{
            title: "People living with HIV (PLHIV)",
            description: "Estimated number of people living with HIV (all ages).",
            source: "UNAIDS AIDSinfo estimates",
            interpretation:
              "A growing PLHIV count alongside falling deaths can reflect treatment success, because more people are surviving on ART; interpret alongside incidence and deaths.",
          }}
        />
        <KpiCard
          label="HIV prevalence (15–49)"
          value={getLatest(prevalence)}
          unit="%"
          previousValue={getPrevious(prevalence)}
          year={getLatestYear(prevalence)}
          previousYear={getPreviousYear(prevalence)}
          source="UNAIDS"
          info={{
            title: "HIV prevalence, adults 15–49",
            description: "Percentage of adults 15–49 living with HIV.",
            source: "UNAIDS AIDSinfo estimates",
            interpretation:
              "Prevalence shifts slowly. Stable or slowly declining prevalence alongside falling incidence indicates people are living longer on treatment.",
          }}
        />
        <KpiCard
          label="ART coverage"
          value={getLatest(art)}
          unit="%"
          previousValue={getPrevious(art)}
          year={getLatestYear(art)}
          previousYear={getPreviousYear(art)}
          source={artCoverage.length > 0 ? "UNAIDS" : "World Bank"}
          info={{
            title: "Antiretroviral therapy coverage",
            description:
              "Share of people living with HIV receiving antiretroviral therapy.",
            source: "UNAIDS AIDSinfo estimates (World Bank fallback)",
            interpretation:
              "The second UNAIDS 95 target is 95% of people diagnosed with HIV on treatment; programmatic ART coverage is not exactly the same denominator. Coverage < 80% signals substantial treatment gaps.",
            referenceUrl:
              "https://www.unaids.org/en/resources/documents/2021/2025-AIDS-targets",
          }}
        />
        <KpiCard
          label="AIDS-related deaths"
          value={getLatest(deaths)}
          unit=""
          previousValue={getPrevious(deaths)}
          year={getLatestYear(deaths)}
          previousYear={getPreviousYear(deaths)}
          source={aidsDeaths.length > 0 ? "UNAIDS" : "WHO GHO"}
          info={{
            title: "AIDS-related deaths (annual)",
            description:
              "Estimated number of deaths attributable to AIDS per year.",
            source: "UNAIDS AIDSinfo estimates (WHO GHO fallback)",
            interpretation:
              "Reflects treatment access, retention, quality, and broader epidemic dynamics. Rising or stagnant death counts in a growing population often signal ART quality or retention problems.",
          }}
        />
      </KpiRow>

      {/* ── Epidemiology trend chart ── */}
      <ChartCard
        title="HIV epidemiology over time"
        caption="Incidence, prevalence and ART coverage trends"
        source="UNAIDS AIDSinfo"
        coverage={[incidence, prevalence, art]}
        info={{
          title: "HIV trend chart",
          description:
            "Three curves: new infections per 1,000 population, prevalence (% adults 15–49), and ART coverage (%). All from UNAIDS modelled estimates.",
          source: "UNAIDS AIDSinfo",
          interpretation:
            "A favorable pattern is falling incidence, rising ART coverage, and declining deaths, with prevalence eventually falling as mortality and new-infection dynamics rebalance.",
        }}
      >
        <TimeSeriesChart
          className="h-full"
          lines={[
            { name: "Incidence (per 1k)", data: incidence, color: "#ef4444", hoverValue: "%{y:.2f} / 1k" },
            { name: "Prevalence (% 15–49)", data: prevalence, color: "#f59e0b", hoverValue: "%{y:.2f}%" },
            { name: "ART coverage (%)", data: art, color: "#10b981", hoverValue: "%{y:.1f}%" },
          ]}
          yAxisTitle="rate / percent"
        />
      </ChartCard>

      {/* ── UNAIDS section ── */}
      {hasUnaids && (
        <>
          {/* UNAIDS absolute burden */}
          {hasAny(plhiv, newInfections, aidsDeaths) && (
            <ChartCard
              title="HIV burden — absolute estimates"
              caption="People living with HIV, new infections, and AIDS deaths"
              source="UNAIDS AIDSinfo"
              coverage={[plhiv, newInfections, aidsDeaths]}
              info={{
                title: "UNAIDS HIV burden estimates",
                description:
                  "Absolute counts from UNAIDS modelled estimates: people living with HIV (PLHIV), new HIV infections per year, and AIDS-related deaths per year.",
                source: "UNAIDS AIDSinfo",
                interpretation:
                  "Falling new infections alongside a growing PLHIV population reflects the success of ART in extending lives. Stable or declining AIDS deaths indicate treatment programme quality.",
              }}
            >
              <TimeSeriesChart
                className="h-full"
                lines={[
                  ...(plhiv.length > 0
                    ? [{ name: "PLHIV", data: plhiv, color: "#3b82f6", hoverValue: "%{y:,.0f}" }]
                    : []),
                  ...(newInfections.length > 0
                    ? [{ name: "New infections", data: newInfections, color: "#f59e0b", hoverValue: "%{y:,.0f}" }]
                    : []),
                  ...(aidsDeaths.length > 0
                    ? [{ name: "AIDS deaths", data: aidsDeaths, color: "#ef4444", hoverValue: "%{y:,.0f}" }]
                    : []),
                ]}
                yAxisTitle="people (number)"
              />
            </ChartCard>
          )}

          {/* 95-95-95 cascade */}
          {hasAny(diagnosed, onArt, suppressed) && (
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5">
                  <div>
                    <h2 className="text-sm font-medium text-muted-foreground">
                      95-95-95 treatment cascade
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                      Latest available values — UNAIDS global targets are 95% at each step
                    </p>
                  </div>
                  <InfoTooltip
                    title="UNAIDS 95-95-95 targets"
                    description="Three sequential targets: 95% of PLHIV know their status; 95% of those diagnosed are on ART; 95% of those on ART achieve viral suppression. Meeting all three would sharply reduce morbidity, mortality, and transmission, supporting the goal of ending AIDS as a public health threat."
                    source="UNAIDS AIDSinfo"
                    interpretation="Gaps at the first step (diagnosis) reflect testing coverage. Gaps at the second (treatment) reflect linkage to care and retention. Gaps at the third (suppression) reflect treatment quality and adherence."
                    referenceUrl="https://www.unaids.org/en/resources/documents/2021/2025-AIDS-targets"
                  />
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground/70">
                  UNAIDS AIDSinfo
                </span>
              </div>

              {/* Cascade bars */}
              <div className="space-y-3">
                {[
                  { label: "Know their HIV status", series: diagnosed, color: "#3b82f6", step: "1st 95" },
                  { label: "Diagnosed and on ART",  series: onArt,     color: "#10b981", step: "2nd 95" },
                  { label: "On ART, virally suppressed", series: suppressed, color: "#8b5cf6", step: "3rd 95" },
                ].map(({ label, series, color, step }) => {
                  const val = getLatest(series);
                  const yr  = getLatestYear(series);
                  if (val === null) return null;
                  const pct = Math.min(100, Math.max(0, val));
                  return (
                    <div key={step}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          <span className="font-medium text-foreground">{step}</span>
                          {" — "}{label}
                          {yr !== undefined && (
                            <span className="ml-1 text-muted-foreground/60">({yr})</span>
                          )}
                        </span>
                        <span className="font-semibold tabular-nums" style={{ color }}>
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                      {/* 95% target line marker */}
                      <div className="relative mt-0.5 h-1">
                        <div
                          className="absolute top-0 h-2 w-px bg-muted-foreground/40"
                          style={{ left: "95%" }}
                          title="95% target"
                        />
                        <span
                          className="absolute top-0 text-[9px] text-muted-foreground/50"
                          style={{ left: "calc(95% + 2px)" }}
                        >
                          95% target
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Cascade trend over time */}
              {hasAny(diagnosed, onArt, suppressed) && (
                <div className="mt-4 h-[220px]">
                  <TimeSeriesChart
                    className="h-full"
                    lines={[
                      ...(diagnosed.length > 0
                        ? [{ name: "Know status (%)", data: diagnosed, color: "#3b82f6", hoverValue: "%{y:.1f}%" }]
                        : []),
                      ...(onArt.length > 0
                        ? [{ name: "On ART (%)", data: onArt, color: "#10b981", hoverValue: "%{y:.1f}%" }]
                        : []),
                      ...(suppressed.length > 0
                        ? [{ name: "Suppressed (%)", data: suppressed, color: "#8b5cf6", hoverValue: "%{y:.1f}%" }]
                        : []),
                    ]}
                    yAxisTitle="% of PLHIV"
                    benchmark={{ value: 95, label: "95% target", color: "#9ca3af", unit: "%" }}
                  />
                </div>
              )}
              <DataCoverage series={[diagnosed, onArt, suppressed]} />
            </div>
          )}

          {/* PMTCT */}
          {pmtct.length > 0 && (
            <ChartCard
              title="Prevention of mother-to-child transmission (PMTCT)"
              caption="ART coverage for pregnant women living with HIV"
              source="UNAIDS AIDSinfo"
              coverage={[pmtct]}
              info={{
                title: "PMTCT coverage",
                description:
                  "Percentage of pregnant women living with HIV who receive antiretroviral medicines to prevent mother-to-child transmission.",
                source: "UNAIDS AIDSinfo / GAM",
                interpretation:
                  "The WHO global target is 95% PMTCT coverage to achieve virtual elimination of vertical HIV transmission. Coverage below 80% leaves significant risk of infant infection.",
              }}
            >
              <TimeSeriesChart
                className="h-full"
                lines={[
                  { name: "PMTCT coverage (%)", data: pmtct, color: "#ec4899", hoverValue: "%{y:.1f}%" },
                ]}
                yAxisTitle="Coverage (%)"
                benchmark={{ value: 95, label: "WHO target", color: "#9ca3af", unit: "%" }}
              />
            </ChartCard>
          )}

          {/* HIV financing */}
          {hasFinancing && (
            <ChartCard
              title="HIV financing flows"
              caption="Stacked bars show how domestic (govt + private) and international sources make up total HIV spending"
              source="UNAIDS AIDSinfo"
              coverage={[finDomesticGov, finDomesticPriv, finInternational]}
              info={{
                title: "HIV financing by source",
                description:
                  "Annual HIV financing split into three components that sum to the total: domestic government, domestic private, and international assistance. International includes Global Fund, PEPFAR, and other bilateral donors.",
                source: "UNAIDS AIDSinfo / GAM — country-reported expenditure",
                interpretation:
                  "High international share creates transition risk when donor funding declines. A rising domestic public share can reduce transition risk, especially where international financing is concentrated. Total = Domestic Government + Domestic Private + International.",
              }}
            >
              <PlotlyChart
                className="h-full"
                data={[
                  // invisible total trace — appears first in the unified tooltip
                  {
                    x: flowsYears,
                    y: flowsYears.map((y) => flowsTotByYear.get(y) ?? 0),
                    name: "Total",
                    type: "scatter" as const,
                    mode: "none" as const,
                    showlegend: false,
                    hovertemplate: "<b>Total: $%{y:,.0f}</b><extra></extra>",
                  },
                  ...(finDomesticGov.length > 0
                    ? [{
                        x: finDomesticGov.map((d) => d.year),
                        y: finDomesticGov.map((d) => d.value),
                        customdata: finDomesticGov.map((d) => {
                          const tot = flowsTotByYear.get(d.year) ?? 1;
                          return [tot, (d.value / tot) * 100];
                        }),
                        name: "Domestic — govt",
                        type: "bar" as const,
                        marker: { color: "#10b981" },
                        hovertemplate: "Domestic govt: $%{y:,.0f} (%{customdata[1]:.1f}%)<extra></extra>",
                      }]
                    : []),
                  ...(finDomesticPriv.length > 0
                    ? [{
                        x: finDomesticPriv.map((d) => d.year),
                        y: finDomesticPriv.map((d) => d.value),
                        customdata: finDomesticPriv.map((d) => {
                          const tot = flowsTotByYear.get(d.year) ?? 1;
                          return [tot, (d.value / tot) * 100];
                        }),
                        name: "Domestic — private",
                        type: "bar" as const,
                        marker: { color: "#34d399" },
                        hovertemplate: "Domestic private: $%{y:,.0f} (%{customdata[1]:.1f}%)<extra></extra>",
                      }]
                    : []),
                  ...(finInternational.length > 0
                    ? [{
                        x: finInternational.map((d) => d.year),
                        y: finInternational.map((d) => d.value),
                        customdata: finInternational.map((d) => {
                          const tot = flowsTotByYear.get(d.year) ?? 1;
                          return [tot, (d.value / tot) * 100];
                        }),
                        name: "International",
                        type: "bar" as const,
                        marker: { color: "#f59e0b" },
                        hovertemplate: "International: $%{y:,.0f} (%{customdata[1]:.1f}%)<extra></extra>",
                      }]
                    : []),
                ]}
                layout={{
                  barmode: "stack",
                  yaxis: { title: { text: "USD" }, tickprefix: "$" },
                  hovermode: "x unified",
                  margin: { l: 80, r: 24, t: 24, b: 40 },
                }}
              />
            </ChartCard>
          )}

          {/* Donor breakdown */}
          {hasAny(finGlobalFund, finPepfar) && (
            <ChartCard
              title="International HIV financing — donor breakdown"
              caption="Stacked bars show Global Fund, PEPFAR and other donors within the international total"
              source="UNAIDS AIDSinfo"
              coverage={[finGlobalFund, finPepfar, finOtherIntl]}
              info={{
                title: "Donor breakdown of international HIV financing",
                description:
                  "Components of international HIV financing: Global Fund grants, PEPFAR (US bilateral) allocations, and remaining other international sources. These stack to equal the international total.",
                source: "UNAIDS AIDSinfo / GAM",
                interpretation:
                  "PEPFAR and the Global Fund together typically account for the majority of international HIV financing in high-burden countries. Concentration in one donor creates transition risk.",
              }}
            >
              <PlotlyChart
                className="h-full"
                data={[
                  // invisible total trace — appears first in the unified tooltip
                  ...(finInternational.length > 0
                    ? [{
                        x: finInternational.map((d) => d.year),
                        y: finInternational.map((d) => d.value),
                        name: "International total",
                        type: "scatter" as const,
                        mode: "none" as const,
                        showlegend: false,
                        hovertemplate: "<b>International total: $%{y:,.0f}</b><extra></extra>",
                      }]
                    : []),
                  ...(finGlobalFund.length > 0
                    ? [{
                        x: finGlobalFund.map((d) => d.year),
                        y: finGlobalFund.map((d) => d.value),
                        customdata: finGlobalFund.map((d) => {
                          const tot = intlByYear.get(d.year) ?? 1;
                          return [tot, (d.value / tot) * 100];
                        }),
                        name: "Global Fund",
                        type: "bar" as const,
                        marker: { color: "#0ea5e9" },
                        hovertemplate: "Global Fund: $%{y:,.0f} (%{customdata[1]:.1f}%)<extra></extra>",
                      }]
                    : []),
                  ...(finPepfar.length > 0
                    ? [{
                        x: finPepfar.map((d) => d.year),
                        y: finPepfar.map((d) => d.value),
                        customdata: finPepfar.map((d) => {
                          const tot = intlByYear.get(d.year) ?? 1;
                          return [tot, (d.value / tot) * 100];
                        }),
                        name: "PEPFAR",
                        type: "bar" as const,
                        marker: { color: "#f97316" },
                        hovertemplate: "PEPFAR: $%{y:,.0f} (%{customdata[1]:.1f}%)<extra></extra>",
                      }]
                    : []),
                  ...(finOtherIntl.length > 0
                    ? [{
                        x: finOtherIntl.map((d) => d.year),
                        y: finOtherIntl.map((d) => d.value),
                        customdata: finOtherIntl.map((d) => {
                          const tot = intlByYear.get(d.year) ?? 1;
                          return [tot, (d.value / tot) * 100];
                        }),
                        name: "Other international",
                        type: "bar" as const,
                        marker: { color: "#94a3b8" },
                        hovertemplate: "Other international: $%{y:,.0f} (%{customdata[1]:.1f}%)<extra></extra>",
                      }]
                    : []),
                ]}
                layout={{
                  barmode: "stack",
                  yaxis: { title: { text: "USD" }, tickprefix: "$" },
                  hovermode: "x unified",
                  margin: { l: 80, r: 24, t: 24, b: 40 },
                }}
              />
            </ChartCard>
          )}
        </>
      )}

      <ExternalFinancingCard external={external} disease="HIV" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TB Panel
// ---------------------------------------------------------------------------

function TbPanel({
  data,
  external,
}: {
  data: IndicatorGroup;
  external: IndicatorTimeSeries[];
}) {
  const { startYear, endYear } = useYearRange();
  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);
  const incidence = f("SH.TBS.INCD");
  const mortality = f("MDG_0000000017");

  if (!hasAny(incidence, mortality))
    return (
      <NoData
        label="TB data"
        hint="This may mean the country is not endemic, or the indicator is not routinely reported to WHO / World Bank."
      />
    );

  return (
    <div className="space-y-6">
      <KpiRow>
        <KpiCard
          label="TB incidence"
          value={getLatest(incidence)}
          unit=" per 100k"
          previousValue={getPrevious(incidence)}
          year={getLatestYear(incidence)}
          previousYear={getPreviousYear(incidence)}
          source="World Bank"
          info={{
            title: "Tuberculosis incidence (per 100,000)",
            description:
              "Estimated new and relapse TB cases per 100,000 population per year.",
            source: "World Bank / WHO",
            interpretation:
              "The WHO End TB Strategy targets an 80% reduction in incidence by 2030 vs. 2015. Slow declines suggest the country is off the pace needed for End TB milestones.",
            referenceUrl: "https://www.who.int/teams/global-tuberculosis-programme/the-end-tb-strategy",
          }}
        />
        <KpiCard
          label="TB mortality"
          value={getLatest(mortality)}
          unit=" per 100k"
          previousValue={getPrevious(mortality)}
          year={getLatestYear(mortality)}
          previousYear={getPreviousYear(mortality)}
          source="WHO GHO"
          info={{
            title: "Tuberculosis mortality (per 100,000)",
            description:
              "Deaths from TB (excluding HIV-positive TB deaths) per 100,000 population per year.",
            source: "WHO GHO",
            interpretation:
              "The End TB Strategy targets a 90% reduction in deaths by 2030 vs. 2015. Mortality responds faster than incidence to case-finding and treatment improvements.",
          }}
        />
      </KpiRow>

      <ChartCard
        title="TB burden over time"
        caption="Incidence and mortality per 100,000"
        source="WHO GHO · World Bank"
        coverage={[incidence, mortality]}
        info={{
          title: "TB burden trend",
          description:
            "Incidence (new and relapse cases) and mortality (excluding HIV+ TB) per 100,000.",
          source: "WHO Global TB Report",
          interpretation:
            "Divergence — flat incidence but falling mortality — usually reflects better treatment, not prevention. Both need to fall for true epidemic control.",
        }}
      >
        <TimeSeriesChart
          className="h-full"
          lines={[
            { name: "Incidence", data: incidence, color: "#7c3aed", hoverValue: "%{y:.0f} / 100k" },
            { name: "Mortality", data: mortality, color: "#ef4444", hoverValue: "%{y:.1f} / 100k" },
          ]}
          yAxisTitle="per 100,000 population"
        />
      </ChartCard>

      <ExternalFinancingCard external={external} disease="TB" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Malaria Panel
// ---------------------------------------------------------------------------

function MalariaPanel({
  data,
  external,
}: {
  data: IndicatorGroup;
  external: IndicatorTimeSeries[];
}) {
  const { startYear, endYear } = useYearRange();
  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);
  const incidence = f("MALARIA_EST_INCIDENCE");
  const mortality = f("MALARIA_EST_MORTALITY");
  const cases = f("MALARIA_EST_CASES");
  const deaths = f("MALARIA_EST_DEATHS");
  const itn = f("MALARIA_ITN_COVERAGE");

  if (!hasAny(incidence, mortality, cases, deaths, itn))
    return (
      <NoData
        label="Malaria data"
        hint="This may mean the country is not endemic, or the indicator is not routinely reported to WHO / World Bank."
      />
    );

  return (
    <div className="space-y-6">
      <KpiRow>
        <KpiCard
          label="Incidence"
          value={getLatest(incidence)}
          unit=" per 1k"
          previousValue={getPrevious(incidence)}
          year={getLatestYear(incidence)}
          previousYear={getPreviousYear(incidence)}
          source="WHO GHO"
          info={{
            title: "Malaria incidence (per 1,000 at risk)",
            description:
              "Estimated cases per 1,000 population at risk per year.",
            source: "WHO World Malaria Report",
            interpretation:
              "The WHO GTS targets 90% reduction in case incidence by 2030 vs. 2015. Countries in pre-elimination phase report rates < 1 per 1,000.",
          }}
        />
        <KpiCard
          label="Mortality"
          value={getLatest(mortality)}
          unit=" per 100k"
          previousValue={getPrevious(mortality)}
          year={getLatestYear(mortality)}
          previousYear={getPreviousYear(mortality)}
          source="WHO GHO"
          info={{
            title: "Malaria mortality (per 100,000 at risk)",
            description:
              "Estimated deaths per 100,000 population at risk per year.",
            source: "WHO World Malaria Report",
          }}
        />
        <KpiCard
          label="Cases (total)"
          value={getLatest(cases)}
          unit=""
          previousValue={getPrevious(cases)}
          year={getLatestYear(cases)}
          previousYear={getPreviousYear(cases)}
          source="WHO GHO"
        />
        <KpiCard
          label="ITN coverage"
          value={getLatest(itn)}
          unit="%"
          previousValue={getPrevious(itn)}
          year={getLatestYear(itn)}
          previousYear={getPreviousYear(itn)}
          source="WHO GHO"
          info={{
            title: "Insecticide-treated net coverage",
            description:
              "Percentage of the population at risk with access to an ITN.",
            source: "WHO World Malaria Report",
            interpretation:
              "ITN access correlates strongly with malaria mortality reduction. The target is universal access for at-risk populations; coverage gaps point to prevention shortfalls.",
          }}
        />
      </KpiRow>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard
          title="Malaria burden rates"
          caption="Incidence and mortality rates"
          source="WHO GHO"
          coverage={[incidence, mortality]}
        >
          <TimeSeriesChart
            className="h-full"
            lines={[
              { name: "Incidence", data: incidence, color: "#0ea5e9", hoverValue: "%{y:.1f} / 1k" },
              { name: "Mortality", data: mortality, color: "#ef4444", hoverValue: "%{y:.1f} / 100k" },
            ]}
            yAxisTitle="rate"
          />
        </ChartCard>
        <ChartCard
          title="Response — ITN coverage"
          caption="Share of at-risk population with net access"
          source="WHO GHO"
          coverage={[itn]}
        >
          <TimeSeriesChart
            className="h-full"
            lines={[
              { name: "ITN coverage", data: itn, color: "#10b981", hoverValue: "%{y:.1f}%" },
            ]}
            yAxisTitle="Coverage (%)"
            benchmark={{ value: 80, label: "Universal access target", color: "#9ca3af", unit: "%" }}
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Absolute burden"
        caption="Total estimated cases and deaths"
        source="WHO GHO"
        coverage={[cases, deaths]}
      >
        <TimeSeriesChart
          className="h-full"
          lines={[
            { name: "Cases", data: cases, color: "#0ea5e9", hoverValue: "%{y:,.0f}" },
            { name: "Deaths", data: deaths, color: "#ef4444", hoverValue: "%{y:,.0f}" },
          ]}
          yAxisTitle="count"
        />
      </ChartCard>

      <ExternalFinancingCard external={external} disease="Malaria" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function ChartCard({
  title,
  caption,
  source,
  info,
  coverage,
  children,
}: {
  title: string;
  caption?: string;
  source?: string;
  info?: React.ComponentProps<typeof InfoTooltip>;
  /** Series to compute data-coverage indicator from. Pass one array per chart line. */
  coverage?: import("@/lib/types").IndicatorTimeSeries[][];
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
            {caption && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                {caption}
              </p>
            )}
          </div>
          {info && <InfoTooltip {...info} />}
        </div>
        {source && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            {source}
          </span>
        )}
      </div>
      <div className="h-[280px]">{children}</div>
      {coverage && <DataCoverage series={coverage} />}
    </div>
  );
}

function ExternalFinancingCard({
  external,
  disease,
}: {
  external: IndicatorTimeSeries[];
  disease: string;
}) {
  if (external.length === 0) return null;
  return (
    <ChartCard
      title="External health financing (% of CHE)"
      caption={`Donor-funded share — context for ${disease} programme dependency`}
      source="WHO GHED"
      coverage={[external]}
      info={{
        title: "External health expenditure (% of current health expenditure)",
        description:
          "Share of total health spending funded from external (donor) sources. Includes grants and in-kind aid.",
        source: "WHO GHED",
        interpretation:
          "High and sustained external shares in disease programmes create transition risk — when donor funding declines, domestic financing must step in to preserve coverage.",
      }}
    >
      <TimeSeriesChart
        className="h-full"
        lines={[
          {
            name: "External (% CHE)",
            data: external,
            color: "#0d9488",
            hoverValue: "%{y:.1f}%",
          },
        ]}
        yAxisTitle="% of CHE"
      />
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// NCDs & Mental Health Panel
// ---------------------------------------------------------------------------

function NcdPanel({ data }: { data: IndicatorGroup }) {
  const { startYear, endYear } = useYearRange();
  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);

  const hypertension = f("NCD_CCS_Hypertension");
  const diabetes     = f("NCD_GLUC_04");
  const obesity      = f("NCD_BMI_30A");
  const inactivity   = f("NCD_PAC_A");
  const suicide      = f("SDGSUICIDE");
  const alcohol      = f("SA_0000001688");
  const mentalOp     = f("MH_12");

  if (!hasAny(hypertension, diabetes, obesity, inactivity, suicide, alcohol, mentalOp)) {
    return (
      <NoData
        label="NCD & mental health data"
        hint="These indicators may not be reported for this country. WHO NCD surveillance coverage varies."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI row — NCD risk factors */}
      <KpiRow>
        <KpiCard
          label="Raised blood pressure prevalence"
          value={getLatest(hypertension)}
          unit="%"
          previousValue={getPrevious(hypertension)}
          year={getLatestYear(hypertension)}
          previousYear={getPreviousYear(hypertension)}
          source="WHO NCD"
          info={{
            title: "Raised blood pressure prevalence (adults 18+)",
            description:
              "Age-standardised prevalence of raised blood pressure (systolic ≥ 140 or diastolic ≥ 90 mmHg) among adults aged 18 and over.",
            source: "WHO Global Health Observatory",
            interpretation:
              "Hypertension is the leading modifiable risk factor for cardiovascular disease and stroke. Prevalence above 25–30% indicates high cardiovascular burden.",
          }}
        />
        <KpiCard
          label="Raised blood glucose (diabetes)"
          value={getLatest(diabetes)}
          unit="%"
          previousValue={getPrevious(diabetes)}
          year={getLatestYear(diabetes)}
          previousYear={getPreviousYear(diabetes)}
          source="WHO NCD"
          info={{
            title: "Raised blood glucose / diabetes prevalence (adults 18+)",
            description:
              "Age-standardised prevalence of raised fasting blood glucose (≥ 7.0 mmol/L) or on medication, among adults 18+.",
            source: "WHO Global Health Observatory",
            interpretation:
              "Rising prevalence reflects increasing metabolic risk across populations. Uncontrolled diabetes drives cardiovascular, renal, and visual complications.",
          }}
        />
        <KpiCard
          label="Obesity prevalence (adults)"
          value={getLatest(obesity)}
          unit="%"
          previousValue={getPrevious(obesity)}
          year={getLatestYear(obesity)}
          previousYear={getPreviousYear(obesity)}
          source="WHO NCD"
          info={{
            title: "Obesity prevalence, adults (BMI ≥ 30)",
            description:
              "Age-standardised prevalence of obesity (BMI ≥ 30 kg/m²) among adults 18+.",
            source: "WHO Global Health Observatory",
            interpretation:
              "Obesity is a primary driver of type 2 diabetes, hypertension, and several cancers. Rapid rises signal deteriorating dietary and physical activity environments.",
          }}
        />
        <KpiCard
          label="Physical inactivity (adults)"
          value={getLatest(inactivity)}
          unit="%"
          previousValue={getPrevious(inactivity)}
          year={getLatestYear(inactivity)}
          previousYear={getPreviousYear(inactivity)}
          source="WHO NCD"
          info={{
            title: "Physical inactivity prevalence, adults",
            description:
              "Age-standardised prevalence of insufficient physical activity among adults 18+, per WHO guidelines.",
            source: "WHO Global Health Observatory",
            interpretation:
              "Physical inactivity directly compounds obesity, diabetes, and cardiovascular risk. The WHO Global Action Plan on Physical Activity targets a 15% reduction by 2030.",
            referenceUrl:
              "https://www.who.int/teams/health-promotion/physical-activity/global-action-plan-on-physical-activity",
          }}
        />
      </KpiRow>

      {/* KPI row — mental health */}
      <KpiRow>
        <KpiCard
          label="Crude suicide rate"
          value={getLatest(suicide)}
          unit=" per 100k"
          previousValue={getPrevious(suicide)}
          year={getLatestYear(suicide)}
          previousYear={getPreviousYear(suicide)}
          source="WHO GHO"
          info={{
            title: "Crude suicide mortality rate (per 100,000)",
            description:
              "Crude (unadjusted) number of deaths from intentional self-harm per 100,000 population.",
            source: "WHO Global Health Observatory (SDG 3.4.2)",
            interpretation:
              "Suicide rates are a sensitive indicator of unmet mental health need. The SDG 3.4.2 target calls for a one-third reduction in premature NCD and mental health mortality by 2030.",
          }}
        />
        <KpiCard
          label="Alcohol use disorders (15+)"
          value={getLatest(alcohol)}
          unit="%"
          previousValue={getPrevious(alcohol)}
          year={getLatestYear(alcohol)}
          previousYear={getPreviousYear(alcohol)}
          source="WHO GHO"
          info={{
            title: "Alcohol use disorders prevalence (15+)",
            description:
              "Share of the population aged 15 and over with an alcohol use disorder as defined by ICD-10/DSM criteria.",
            source: "WHO Global Health Observatory",
            interpretation:
              "Alcohol use disorders are a leading cause of disease burden, liver cirrhosis, and injury. High prevalence strains mental health and emergency care systems.",
          }}
        />
        <KpiCard
          label="Mental health outpatient rate"
          value={getLatest(mentalOp)}
          unit=" per 100k"
          previousValue={getPrevious(mentalOp)}
          year={getLatestYear(mentalOp)}
          previousYear={getPreviousYear(mentalOp)}
          source="WHO ATLAS"
          info={{
            title: "Mental health outpatient treatment rate (per 100,000)",
            description:
              "Number of people treated in outpatient mental health facilities per 100,000 population per year.",
            source: "WHO Mental Health Atlas",
            interpretation:
              "Treatment rate reflects system capacity relative to need. Low rates in high-burden settings indicate large treatment gaps.",
          }}
        />
      </KpiRow>

      {/* NCD risk factor trends */}
      {hasAny(hypertension, diabetes, obesity) && (
        <ChartCard
          title="NCD risk factor prevalence over time"
          caption="Age-standardised prevalence among adults 18+"
          source="WHO NCD"
          coverage={[hypertension, diabetes, obesity]}
          info={{
            title: "NCD risk factor trends",
            description:
              "Age-standardised prevalence of three major metabolic risk factors: hypertension, raised blood glucose (diabetes), and obesity.",
            source: "WHO Global Health Observatory",
            interpretation:
              "Rising simultaneous trends across risk factors indicate a systemic shift in population metabolic health, typically driven by urbanisation, dietary change, and reduced physical activity.",
          }}
        >
          <TimeSeriesChart
            className="h-full"
            lines={[
              { name: "Hypertension (%)", data: hypertension, color: "#dc2626", hoverValue: "%{y:.1f}%", mode: "lines+markers" },
              { name: "Diabetes (%)", data: diabetes, color: "#d97706", hoverValue: "%{y:.1f}%", mode: "lines+markers" },
              { name: "Obesity (%)", data: obesity, color: "#7c3aed", hoverValue: "%{y:.1f}%", mode: "lines+markers" },
            ]}
            yAxisTitle="Prevalence (%)"
          />
        </ChartCard>
      )}

      {/* Physical inactivity trend */}
      {inactivity.length > 0 && (
        <ChartCard
          title="Physical inactivity prevalence"
          caption="Adults failing to meet WHO physical activity guidelines"
          source="WHO NCD"
          coverage={[inactivity]}
          info={{
            title: "Physical inactivity trend",
            description:
              "Age-standardised prevalence of adults not meeting WHO recommended physical activity levels.",
            source: "WHO Global Health Observatory",
            interpretation:
              "Physical inactivity has plateaued or worsened in many middle- and high-income countries despite global targets, reflecting structural barriers in built environments and labour patterns.",
          }}
        >
          <TimeSeriesChart
            className="h-full"
            lines={[
              { name: "Physical inactivity (%)", data: inactivity, color: "#0ea5e9", hoverValue: "%{y:.1f}%", mode: "lines+markers" },
            ]}
            yAxisTitle="Prevalence (%)"
            benchmark={{ value: 15, label: "WHO 2030 reduction target (relative)", color: "#9ca3af", unit: "%" }}
          />
        </ChartCard>
      )}

      {/* Mental health & suicide trends */}
      {hasAny(suicide, alcohol, mentalOp) && (
        <ChartCard
          title="Mental health indicators over time"
          caption="Suicide rate, alcohol use disorders, and outpatient treatment rate"
          source="WHO GHO · WHO ATLAS"
          coverage={[suicide, alcohol, mentalOp]}
          info={{
            title: "Mental health outcome and service trends",
            description:
              "Crude suicide rate per 100,000, alcohol use disorder prevalence (%), and mental health outpatient treatment rate per 100,000.",
            source: "WHO GHO / WHO Mental Health Atlas",
            interpretation:
              "Declining suicide rates alongside rising outpatient treatment rates indicate improving system responsiveness. Divergence — rising suicide with low treatment rates — signals substantial unmet need.",
          }}
        >
          <TimeSeriesChart
            className="h-full"
            lines={[
              ...(suicide.length > 0 ? [{ name: "Suicide rate (per 100k)", data: suicide, color: "#ef4444", hoverValue: "%{y:.1f}", mode: "lines+markers" as const }] : []),
              ...(alcohol.length > 0 ? [{ name: "Alcohol use disorders (%)", data: alcohol, color: "#f59e0b", hoverValue: "%{y:.1f}%", mode: "lines+markers" as const }] : []),
              ...(mentalOp.length > 0 ? [{ name: "MH outpatient (per 100k)", data: mentalOp, color: "#8b5cf6", hoverValue: "%{y:.0f}", mode: "lines+markers" as const }] : []),
            ]}
            yAxisTitle="rate / percent"
          />
        </ChartCard>
      )}
    </div>
  );
}

