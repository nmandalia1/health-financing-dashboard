"use client";

import { useState } from "react";
import { useFiscalData } from "@/hooks/use-fiscal-data";
import { usePeerBenchmarks } from "@/hooks/use-peer-benchmarks";
import { ViewHeader } from "@/components/ui/view-header";
import { BenchmarkToggle } from "@/components/ui/benchmark-toggle";
import { YearRangePicker } from "@/components/ui/year-range-picker";
import { useYearRange } from "@/lib/year-range-context";
import { filterByYears } from "@/lib/filter-years";
import { KpiRow } from "@/components/kpi/kpi-row";
import { KpiRowSkeleton } from "@/components/kpi/kpi-row-skeleton";
import { KpiCard } from "@/components/kpi/kpi-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { makeBandTraces } from "@/lib/peer-band-utils";
import type { Data } from "plotly.js-dist-min";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DataCoverage } from "@/components/ui/data-coverage";
import { FiscalVerdict } from "./fiscal-verdict";

const PEER_INDICATORS = [
  "GHED_gghed_gge",   // Govt health % GGE — shown on right y-axis of hero
  "GGXWDG_NGDP",     // Govt gross debt chart
  "GGXCNL_NGDP",     // Net lending/borrowing chart
];

// ─── Helper functions ───────────────────────────────────────────────────────

function getLatest(d?: { year: number; value: number }[]) {
  return d && d.length ? d[d.length - 1].value : null;
}

function getLatestYear(d?: { year: number; value: number }[]) {
  return d && d.length ? d[d.length - 1].year : undefined;
}

function getPrevious(d?: { year: number; value: number }[]) {
  return d && d.length >= 2 ? d[d.length - 2].value : undefined;
}

function getPreviousYear(d?: { year: number; value: number }[]) {
  return d && d.length >= 2 ? d[d.length - 2].year : undefined;
}

const ABUJA_TARGET = 15;

// ─── Component ──────────────────────────────────────────────────────────────

export function FiscalSpace({ iso3 }: { iso3: string }) {
  const { data, isLoading } = useFiscalData(iso3);
  const [showPeers, setShowPeers] = useState(false);
  const {
    bands,
    incomeGroup,
    isLoading: peersLoading,
  } = usePeerBenchmarks(iso3, PEER_INDICATORS);
  const { startYear, endYear } = useYearRange();

  // Loading skeleton
  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <ViewHeader
          title="Fiscal Space for Health"
          question="Is there room to increase public spending on health?"
        />
        <KpiRowSkeleton />
        <div className="h-[420px] animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  // ── Indicator series ──────────────────────────────────────────────────────
  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);
  const ggeData = f("GHED_gghed_gge");
  const govtGDP = f("GHED_gghed_gdp");
  const ggeGDP = f("GHED_gge_gdp");
  const revenue = f("GC.REV.XGRT.GD.ZS");
  const debtData = f("GGXWDG_NGDP");
  const balanceData = f("GGXCNL_NGDP");
  const inflation = f("PCPIPCH");
  const gdpGrowth = f("NGDP_RPCH");

  // ── KPI values ────────────────────────────────────────────────────────────
  const latestGGE = getLatest(ggeData);
  const latestGovtGDP = getLatest(govtGDP);
  const latestRevenue = getLatest(revenue);
  const latestBalance = getLatest(balanceData);


  // ── Hero chart traces ─────────────────────────────────────────────────────
  // All years from the three series for the Abuja flat line x-range
  const heroYears = [
    ...new Set([
      ...revenue.map((d) => d.year),
      ...ggeGDP.map((d) => d.year),
      ...ggeData.map((d) => d.year),
    ]),
  ].sort((a, b) => a - b);
  const heroMinYear = heroYears[0] ?? 2000;
  const heroMaxYear = heroYears[heroYears.length - 1] ?? 2023;

  // ── Peer band traces for hero chart (right y-axis: govt health % GGE) ────
  const heroBandTraces: Data[] =
    showPeers && bands?.["GHED_gghed_gge"]
      ? makeBandTraces(bands["GHED_gghed_gge"], {
          incomeGroup: incomeGroup!,
          color: "#16a34a",
          yaxis: "y2",
        })
      : [];

  const heroTraces: Data[] = [
    ...heroBandTraces,
    // Govt revenue % GDP — left y-axis (blue dashed)
    {
      x: revenue.map((d) => d.year),
      y: revenue.map((d) => d.value),
      name: "Govt revenue (% GDP)",
      type: "scatter",
      mode: "lines",
      yaxis: "y",
      line: { color: "#2563eb", width: 2, dash: "dash" },
      hovertemplate: "%{x}: %{y:.1f}%<extra>Govt revenue % GDP</extra>",
    },
    // General govt expenditure % GDP — left y-axis (grey solid)
    {
      x: ggeGDP.map((d) => d.year),
      y: ggeGDP.map((d) => d.value),
      name: "Govt expenditure (% GDP)",
      type: "scatter",
      mode: "lines",
      yaxis: "y",
      line: { color: "#6b7280", width: 2, dash: "solid" },
      hovertemplate: "%{x}: %{y:.1f}%<extra>Govt expenditure % GDP</extra>",
    },
    // Govt health % GGE — right y-axis (green solid)
    {
      x: ggeData.map((d) => d.year),
      y: ggeData.map((d) => d.value),
      name: "Govt health (% GGE)",
      type: "scatter",
      mode: "lines",
      yaxis: "y2",
      line: { color: "#16a34a", width: 2.5, dash: "solid" },
      hovertemplate: "%{x}: %{y:.1f}%<extra>Govt health % GGE</extra>",
    },
    // Abuja 15% target flat line on right y-axis
    {
      x: [heroMinYear, heroMaxYear],
      y: [ABUJA_TARGET, ABUJA_TARGET],
      name: "Abuja target (15%)",
      type: "scatter",
      mode: "lines",
      yaxis: "y2",
      line: { color: "#ef4444", width: 1.5, dash: "dot" },
      hovertemplate: `Abuja target: 15%<extra></extra>`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <ViewHeader
        title="Fiscal Space for Health"
        question="Is there room to increase public spending on health?"
      >
        <YearRangePicker />
        {incomeGroup && (
          <BenchmarkToggle
            enabled={showPeers}
            onToggle={() => setShowPeers((v) => !v)}
            incomeGroup={incomeGroup}
            isLoading={peersLoading}
          />
        )}
      </ViewHeader>

      {/* Composite verdict — headline index + transparent 7-pillar breakdown */}
      <FiscalVerdict iso3={iso3} />

      {/* KPI row */}
      <KpiRow>
        <KpiCard
          label="Health share of government spending"
          value={latestGGE}
          unit="%"
          year={getLatestYear(ggeData)}
          previousValue={getPrevious(ggeData)}
          previousYear={getPreviousYear(ggeData)}
          source="WHO GHED"
          info={{
            title: "Government health spending (% of government spending)",
            description:
              "Domestic government health expenditure as a share of total general government expenditure (GGE).",
            source: "WHO GHED",
            interpretation:
              "Shows how much priority health receives within the public budget. The Abuja Declaration set a 15% reference for African Union members.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="Public health spending (% of GDP)"
          value={latestGovtGDP}
          unit="%"
          year={getLatestYear(govtGDP)}
          previousValue={getPrevious(govtGDP)}
          previousYear={getPreviousYear(govtGDP)}
          source="WHO GHED"
          info={{
            title: "Public health spending (% of GDP)",
            description:
              "Domestic government health expenditure relative to GDP — combines fiscal priority and overall fiscal capacity.",
            source: "WHO GHED",
            interpretation:
              "Around 5% of GDP from public sources is often used as a reference for progress toward UHC, but it is not a binding global standard.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="Government revenue (% of GDP)"
          value={latestRevenue}
          unit="%"
          year={getLatestYear(revenue)}
          previousValue={getPrevious(revenue)}
          previousYear={getPreviousYear(revenue)}
          source="World Bank"
          info={{
            title: "Government revenue (% of GDP)",
            description:
              "Total domestic public revenue excluding grants, shown as a share of GDP. It captures the size of the public resource envelope before allocation decisions.",
            source: "World Bank WDI",
            interpretation:
              "For tax revenue, about 15% of GDP is often cited as a state-capacity reference point. This series is total revenue excluding grants, so compare carefully.",
            referenceUrl: "https://data.worldbank.org/indicator/GC.REV.XGRT.GD.ZS",
          }}
        />
        <KpiCard
          label="Fiscal balance (% GDP)"
          value={latestBalance}
          unit="%"
          year={getLatestYear(balanceData)}
          previousValue={getPrevious(balanceData)}
          previousYear={getPreviousYear(balanceData)}
          source="IMF WEO"
          info={{
            title: "Net lending / borrowing (% GDP)",
            description:
              "General government net lending (+) or borrowing (–) as a share of GDP. Positive = surplus, negative = deficit.",
            source: "IMF World Economic Outlook",
            interpretation:
              "Large persistent deficits constrain future fiscal space — debt service crowds out social spending. Surpluses or small deficits create room to increase health allocations.",
            referenceUrl: "https://www.imf.org/en/Publications/WEO",
          }}
        />
      </KpiRow>

      {/* Hero chart */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex items-start gap-1.5">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">
                Public resource envelope and health priority
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                Govt revenue & expenditure (left axis, % GDP) vs govt health
                allocation (right axis, % GGE)
              </p>
            </div>
            <InfoTooltip
              title="Public resource envelope and health priority"
              description="Compares the size of the public resource envelope (% of GDP) with the share of that envelope allocated to health (% of government spending), against the Abuja 15% reference line."
              source="WHO GHED, World Bank WDI, IMF WEO"
              interpretation="Revenue growing faster than spending suggests consolidation; spending growing with a flat health share implies other sectors are absorbing the growth. Rising health share on a growing envelope is the ideal pattern."
              referenceUrl="https://apps.who.int/nha/database"
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            WHO GHED · World Bank · IMF WEO
          </span>
        </div>
        <div className="h-[420px]">
          <PlotlyChart
            className="h-full"
            data={heroTraces}
            layout={{
              hovermode: "x unified",
              margin: { l: 56, r: 72, t: 24, b: 40 },
              yaxis: {
                title: { text: "% of GDP" },
                gridcolor: "#f3f4f6",
                linecolor: "#e5e7eb",
                zeroline: false,
                ticksuffix: "%",
              },
              yaxis2: {
                title: { text: "% of GGE (right)" },
                overlaying: "y",
                side: "right",
                gridcolor: "transparent",
                linecolor: "#e5e7eb",
                zeroline: false,
                ticksuffix: "%",
              },
            }}
          />
        </div>
        <DataCoverage series={[revenue, ggeGDP]} />
      </div>

      {/* Secondary charts: Debt and Fiscal balance */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Govt gross debt */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Govt gross debt
              </h2>
              <InfoTooltip
                title="General government gross debt (% GDP)"
                description="Total outstanding gross debt liabilities of the general government as a share of GDP."
                source="IMF WEO"
                interpretation="Debt thresholds vary by country context and debt-carrying capacity. Rising debt can reduce future health fiscal space through higher debt service."
                referenceUrl="https://www.imf.org/external/datamapper/datasets/WEO"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              IMF WEO
            </span>
          </div>
          <div className="h-[280px]">
            <TimeSeriesChart
              className="h-full"
              lines={[
                {
                  name: "Govt gross debt",
                  data: debtData,
                  color: "#ef4444",
                  hoverValue: "%{y:.1f}%",
                },
              ]}
              peerBand={
                showPeers && bands?.["GGXWDG_NGDP"]
                  ? {
                      data: bands["GGXWDG_NGDP"],
                      incomeGroup: incomeGroup!,
                      color: "#ef4444",
                    }
                  : undefined
              }
              yAxisTitle="% of GDP"
            />
          </div>
          <DataCoverage series={[debtData]} />
        </div>

        {/* Net lending/borrowing (fiscal balance) */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  Net lending / borrowing
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Positive = surplus · Negative = deficit
                </p>
              </div>
              <InfoTooltip
                title="Fiscal balance over time"
                description="Net lending/borrowing trajectory. Persistent large deficits can raise debt-service pressures. The 3% line is a fiscal-rule reference point, not a universal danger threshold."
                source="IMF WEO"
                interpretation="Shocks (COVID, commodity swings, conflict) show up as sudden deficit widening. Recovery path determines whether health spending protected during the shock can be sustained."
                referenceUrl="https://www.imf.org/en/Publications/WEO"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              IMF WEO
            </span>
          </div>
          <div className="h-[280px]">
            <TimeSeriesChart
              className="h-full"
              lines={[
                {
                  name: "Net lending/borrowing",
                  data: balanceData,
                  color: "#2563eb",
                  hoverValue: "%{y:.1f}%",
                },
              ]}
              benchmark={{
                value: 0,
                label: "Balanced budget",
                color: "#9ca3af",
                unit: "%",
              }}
              peerBand={
                showPeers && bands?.["GGXCNL_NGDP"]
                  ? {
                      data: bands["GGXCNL_NGDP"],
                      incomeGroup: incomeGroup!,
                      color: "#2563eb",
                    }
                  : undefined
              }
              yAxisTitle="% of GDP"
            />
          </div>
          <DataCoverage series={[balanceData]} />
        </div>
      </div>

      {/* Macro sparklines */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                GDP growth (annual %)
              </h2>
              <InfoTooltip
                title="Real GDP growth"
                description="Annual percentage change in real GDP."
                source="IMF WEO"
                interpretation="Sustained growth expands the fiscal pie — health budgets can rise without raising the tax share. Recessions compress both the envelope and the share."
                referenceUrl="https://www.imf.org/en/Publications/WEO"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              IMF WEO
            </span>
          </div>
          <div className="h-[100px]">
            <Sparkline
              className="h-full"
              data={gdpGrowth}
              color="#2563eb"
              label="GDP growth %"
              hoverValue="%{y:.1f}%"
            />
          </div>
          <DataCoverage series={[gdpGrowth]} />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Inflation (annual %)
              </h2>
              <InfoTooltip
                title="Consumer price inflation"
                description="Annual percentage change in the consumer price index."
                source="IMF WEO"
                interpretation="High or volatile inflation erodes the purchasing power of health budgets and household payments. Watch for divergence between nominal spending growth and real per-capita trends."
                referenceUrl="https://www.imf.org/en/Publications/WEO"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              IMF WEO
            </span>
          </div>
          <div className="h-[100px]">
            <Sparkline
              className="h-full"
              data={inflation}
              color="#d97706"
              label="Inflation %"
              hoverValue="%{y:.1f}%"
            />
          </div>
          <DataCoverage series={[inflation]} />
        </div>
      </div>
    </div>
  );
}
