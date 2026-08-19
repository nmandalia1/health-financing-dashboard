"use client";

import { useState } from "react";
import type { Data } from "plotly.js-dist-min";
import { useProtectionData } from "@/hooks/use-protection-data";
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
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DataCoverage } from "@/components/ui/data-coverage";

const PEER_INDICATORS = [
  "GHED_oops_che",  // OOP share — hero chart + pooling chart
  "GHED_ext_che",   // External resources — donor dependency chart
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function getLatest(d?: { year: number; value: number }[]) {
  return d?.length ? d[d.length - 1].value : null;
}

function getLatestYear(d?: { year: number; value: number }[]) {
  return d?.length ? d[d.length - 1].year : undefined;
}

function getPrevious(d?: { year: number; value: number }[]) {
  return (d?.length ?? 0) >= 2 ? d![d!.length - 2].value : undefined;
}

function getPreviousYear(d?: { year: number; value: number }[]) {
  return (d?.length ?? 0) >= 2 ? d![d!.length - 2].year : undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FinancialProtection({ iso3 }: { iso3: string }) {
  const { data, isLoading } = useProtectionData(iso3);
  const [showPeers, setShowPeers] = useState(false);
  const {
    bands,
    incomeGroup,
    isLoading: peersLoading,
  } = usePeerBenchmarks(iso3, PEER_INDICATORS);
  const { startYear, endYear } = useYearRange();

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <ViewHeader
          title="Financial Protection & Equity"
          question="Are health costs creating financial hardship?"
        />
        <KpiRowSkeleton trace />
        <div className="h-[380px] animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);
  const oop = f("GHED_oops_che");
  const oopPC = f("GHED_oop_pc_usd");
  const ext = f("GHED_ext_che");
  const cfa = f("GHED_cfa_che");
  const poverty = f("SI.POV.DDAY");
  const gini = f("SI.POV.GINI");

  const latestOOP = getLatest(oop);
  const latestOOPPC = getLatest(oopPC);
  const latestGini = getLatest(gini);
  const latestPoverty = getLatest(poverty);

  // OOP threshold colour logic
  const oopColorClass =
    latestOOP !== null
      ? latestOOP > 40
        ? "text-red-600"
        : latestOOP > 20
          ? "text-amber-600"
          : undefined
      : undefined;

  // ── Peer band traces for OOP hero chart ────────────────────────────────
  const oopBandTraces: Data[] =
    showPeers && bands?.["GHED_oops_che"]
      ? makeBandTraces(bands["GHED_oops_che"], {
          incomeGroup: incomeGroup!,
          color: "#9ca3af",
        })
      : [];

  // Hero chart traces
  const oopValues = oop.map((d) => d.value);
  const oopYears = oop.map((d) => d.year);
  const maxOOP = oopValues.length ? Math.max(...oopValues) : 20;

  const isAboveThreshold = latestOOP !== null && latestOOP > 20;
  const areaFillColor = isAboveThreshold ? "#ef444420" : "#d9770620";
  const lineColor = isAboveThreshold ? "#ef4444" : "#d97706";

  const heroTraces: Data[] = [
    ...oopBandTraces,
    {
      type: "scatter",
      mode: "lines",
      name: "OOP share",
      x: oopYears,
      y: oopValues,
      fill: "tozeroy",
      fillcolor: areaFillColor,
      line: { color: lineColor, width: 2 },
      hovertemplate:
        "<b>OOP share</b>: %{y:.1f}% of CHE  <span style=\"color:#9ca3af\">· WHO GHED</span><extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines",
      name: "WHO threshold (20%)",
      x: oopYears.length > 0 ? [oopYears[0], oopYears[oopYears.length - 1]] : [],
      y: [20, 20],
      line: { color: "#ef4444", width: 1.5, dash: "dash" },
      hoverinfo: "skip",
    },
  ];

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Financial Protection & Equity"
        question="Are health costs creating financial hardship?"
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

      {/* KPI Cards */}
      <KpiRow>
        <KpiCard
          label="Household out-of-pocket share"
          series={oop}
          direction="lower-better"
          value={latestOOP}
          unit="%"
          previousValue={getPrevious(oop)}
          year={getLatestYear(oop)}
          previousYear={getPreviousYear(oop)}
          source="WHO GHED"
          colorClass={oopColorClass}
          info={{
            title: "Household out-of-pocket share of health spending",
            description:
              "Direct household payments at point of service as a share of current health expenditure.",
            source: "WHO GHED",
            interpretation:
              "When OOP exceeds about 20% of current health expenditure, countries often face higher risk of catastrophic health spending. Above 40% indicates serious reliance on household payments.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="OOP per capita"
          series={oopPC}
          direction="lower-better"
          value={latestOOPPC}
          unit="$"
          previousValue={getPrevious(oopPC)}
          year={getLatestYear(oopPC)}
          previousYear={getPreviousYear(oopPC)}
          source="WHO GHED"
          info={{
            title: "OOP per capita (USD)",
            description:
              "Absolute USD burden of out-of-pocket health payments per person.",
            source: "WHO GHED",
            interpretation:
              "The share metric can fall while absolute OOP rises (if total spending grows faster). The per-capita view reveals the real financial burden on households.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="Gini index"
          series={gini}
          direction="lower-better"
          value={latestGini !== null ? Math.round(latestGini * 10) / 10 : null}
          unit=""
          previousValue={getPrevious(gini)}
          year={getLatestYear(gini)}
          previousYear={getPreviousYear(gini)}
          source="World Bank"
          info={{
            title: "Gini index (income inequality)",
            description:
              "0 = perfect equality, 100 = maximum inequality. Measures distribution of household income/consumption.",
            source: "World Bank (PovcalNet / PIP)",
            interpretation:
              "High inequality compounds health-financing risk: OOP payments fall disproportionately on poorer households. Gini above 40 typically signals distributional stress.",
            referenceUrl: "https://pip.worldbank.org",
          }}
        />
        <KpiCard
          label="Poverty headcount"
          series={poverty}
          direction="lower-better"
          value={latestPoverty}
          unit="%"
          previousValue={getPrevious(poverty)}
          year={getLatestYear(poverty)}
          previousYear={getPreviousYear(poverty)}
          source="World Bank"
          info={{
            title: "Poverty headcount ($2.15/day, 2017 PPP)",
            description:
              "Share of the population living on less than $2.15 per day (international extreme-poverty line, 2017 PPP).",
            source: "World Bank PIP",
            interpretation:
              "Context for financial-protection analysis: where extreme poverty is high, even modest OOP payments push households below the line. Rises in OOP per capita here are especially damaging.",
            referenceUrl: "https://pip.worldbank.org",
          }}
        />
      </KpiRow>

      {/* Hero chart */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex items-start gap-1.5">
            <h2 className="text-sm font-medium text-muted-foreground">
              Out-of-pocket expenditure (% of current health expenditure)
            </h2>
            <InfoTooltip
              title="OOP share over time"
              description="Time series of OOP as a share of current health expenditure. The dashed line marks a commonly used 20% OOP watch point."
              source="WHO GHED"
              interpretation="Persistent trend above 20% typically coincides with catastrophic-spending rates above 10% of households. Falling OOP is the clearest financial-protection success signal."
              referenceUrl="https://apps.who.int/nha/database"
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            WHO GHED
          </span>
        </div>
        <div className="h-[380px]">
          <PlotlyChart
            className="h-full"
            data={heroTraces}
            layout={{
              hovermode: "x unified",
              yaxis: {
                title: { text: "% of current health expenditure" },
                ticksuffix: "%",
                // Always show at least 0–35 so the 20% WHO threshold is visible
                range: [0, Math.max(maxOOP * 1.2, 35)],
              },
            }}
          />
        </div>
        <DataCoverage series={[oop]} />
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          Source: WHO Global Health Expenditure Database (GHED). WHO recommends
          OOP &lt; 20% of CHE for adequate financial protection.
        </p>
      </div>

      {/* Secondary charts: Donor dependency & Pooling quality */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Donor dependency */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Donor dependency
              </h2>
              <InfoTooltip
                title="External resources (% CHE)"
                description="Share of current health expenditure financed by external (donor) sources, including bilateral aid and global health initiatives."
                source="WHO GHED"
                interpretation="High donor dependency creates sustainability risk — services may become difficult to sustain if aid declines before domestic financing increases. Countries transitioning from donor funding need deliberate domestic-resource-mobilization plans."
                referenceUrl="https://apps.who.int/nha/database"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              WHO GHED
            </span>
          </div>
          <div className="h-[250px]">
            <TimeSeriesChart
              className="h-full"
              lines={[
                {
                  name: "External resources (% CHE)",
                  data: ext,
                  color: "#0d9488",
                  hoverValue: "%{y:.1f}%",
                },
              ]}
              peerBand={
                showPeers && bands?.["GHED_ext_che"]
                  ? {
                      data: bands["GHED_ext_che"],
                      incomeGroup: incomeGroup!,
                      color: "#0d9488",
                    }
                  : undefined
              }
              yAxisTitle="% of CHE"
            />
          </div>
          <DataCoverage series={[ext]} />
        </div>

        {/* Pooling quality */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  Pooling quality
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Higher compulsory financing = better financial protection
                </p>
              </div>
              <InfoTooltip
                title="Pooling quality (CFA vs OOP)"
                description="Compulsory financing arrangements (CFA — government + mandatory insurance) vs out-of-pocket, shown against WHO's 20% OOP threshold."
                source="WHO GHED"
                interpretation="When CFA is well above OOP and rising, pooling is deepening. When the two lines sit near each other or cross, households are bearing equivalent risk to pooled schemes — a warning sign that households are carrying too much direct payment risk."
                referenceUrl="https://apps.who.int/nha/database"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              WHO GHED
            </span>
          </div>
          <div className="h-[250px]">
            <TimeSeriesChart
              className="h-full"
              lines={[
                {
                  name: "Compulsory financing (CFA)",
                  data: cfa,
                  color: "#2563eb",
                  hoverValue: "%{y:.1f}%",
                },
                {
                  name: "Out-of-pocket (OOP)",
                  data: oop,
                  color: "#d97706",
                  hoverValue: "%{y:.1f}%",
                },
              ]}
              yAxisTitle="% of CHE"
              benchmark={{
                value: 20,
                label: "WHO OOP threshold (20%)",
                color: "#ef4444",
                unit: "%",
              }}
            />
          </div>
          <DataCoverage series={[cfa, oop]} />
        </div>
      </div>

      {/* Context sparklines: Poverty & Gini */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Poverty headcount ($2.15/day)
              </h2>
              <InfoTooltip
                title="Extreme poverty trend"
                description="Share of population living below $2.15/day (2017 PPP). Declining trends indicate broad-based income growth."
                source="World Bank PIP"
                interpretation="OOP health payments are especially damaging when baseline poverty is high — households can be pushed into poverty by a single episode of serious illness."
                referenceUrl="https://pip.worldbank.org"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              World Bank
            </span>
          </div>
          <div className="h-[120px]">
            <Sparkline
              className="h-full"
              data={poverty}
              color="#ef4444"
              label="Poverty headcount ($2.15/day)"
              hoverValue="%{y:.1f}%"
            />
          </div>
          <DataCoverage series={[poverty]} />
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Gini index
              </h2>
              <InfoTooltip
                title="Gini index trend"
                description="Inequality of income/consumption over time. Higher = more unequal."
                source="World Bank"
                interpretation="Rising inequality alongside rising OOP is especially concerning for equity and financial protection — the poor pay a larger absolute share of a growing burden."
                referenceUrl="https://pip.worldbank.org"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              World Bank
            </span>
          </div>
          <div className="h-[120px]">
            <Sparkline
              className="h-full"
              data={gini}
              color="#f97316"
              label="Gini index"
              hoverValue="%{y:.1f}"
            />
          </div>
          <DataCoverage series={[gini]} />
        </div>
      </div>
    </div>
  );
}
