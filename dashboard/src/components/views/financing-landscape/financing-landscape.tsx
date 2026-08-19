"use client";

import { useState } from "react";
import { useFinancingData } from "@/hooks/use-financing-data";
import { usePeerBenchmarks } from "@/hooks/use-peer-benchmarks";
import { ViewHeader } from "@/components/ui/view-header";
import { BenchmarkToggle } from "@/components/ui/benchmark-toggle";
import { KpiRow } from "@/components/kpi/kpi-row";
import { KpiRowSkeleton } from "@/components/kpi/kpi-row-skeleton";
import { KpiCard } from "@/components/kpi/kpi-card";
import { StackedAreaChart } from "@/components/charts/stacked-area-chart";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { FINANCING_COLORS } from "@/components/charts/chart-config";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { YearRangePicker } from "@/components/ui/year-range-picker";
import { useYearRange } from "@/lib/year-range-context";
import { filterByYears } from "@/lib/filter-years";
import { DataCoverage } from "@/components/ui/data-coverage";

const PEER_INDICATORS = [
  "GHED_gghed_gge",    // Fiscal priority chart
  "GHED_che_usd2023_pc", // Real spending chart
  "GHED_oops_che",     // Pooling vs OOP chart (OOP line)
  "GHED_cfa_che",      // Pooling vs OOP chart (CFA line)
];

function getLatest(data: { year: number; value: number }[] | undefined) {
  if (!data || data.length === 0) return null;
  return data[data.length - 1].value;
}

function getLatestYear(data: { year: number; value: number }[] | undefined) {
  if (!data || data.length === 0) return undefined;
  return data[data.length - 1].year;
}

function getPrevious(data: { year: number; value: number }[] | undefined) {
  if (!data || data.length < 2) return undefined;
  return data[data.length - 2].value;
}

function getPreviousYear(data: { year: number; value: number }[] | undefined) {
  if (!data || data.length < 2) return undefined;
  return data[data.length - 2].year;
}

export function FinancingLandscape({ iso3 }: { iso3: string }) {
  const { data, isLoading } = useFinancingData(iso3);
  const { startYear, endYear } = useYearRange();
  const [showPeers, setShowPeers] = useState(false);
  const {
    bands,
    incomeGroup,
    isLoading: peersLoading,
  } = usePeerBenchmarks(iso3, PEER_INDICATORS);

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <ViewHeader
          title="The Financing Landscape"
          question="Where does health money come from and how much is there?"
        />
        <KpiRowSkeleton />
        <div className="h-[400px] animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);

  const govt = f("GHED_gghed_che");
  const oop = f("GHED_oops_che");
  const ext = f("GHED_ext_che");
  const priv = f("GHED_pvtd_che");
  const cfa = f("GHED_cfa_che");
  const chePC = f("GHED_che_pc_usd");
  const chePCReal = f("GHED_che_usd2023_pc");
  const cheGDP = f("GHED_che_gdp");
  const govtGGE = f("GHED_gghed_gge");
  const govtGDP = f("GHED_gghed_gdp");
  const gdpPC = f("NGDPDPC");
  const gdpGrowth = f("NGDP_RPCH");

  // SHA 2011 decomposition: GGHE-D + PVT-D + EXT = 100% of CHE
  // OOP is a subset of PVT-D — stacking it separately would double-count and exceed 100%
  // Only render years where all 3 segments have data (inner join)
  const govtYears = new Set(govt.map((d) => d.year));
  const privYears = new Set(priv.map((d) => d.year));
  const extYears = new Set(ext.map((d) => d.year));
  const completeYears = new Set(
    [...govtYears].filter((y) => privYears.has(y) && extYears.has(y))
  );
  const govtStack = govt.filter((d) => completeYears.has(d.year));
  const privStack = priv.filter((d) => completeYears.has(d.year));
  const extStack = ext.filter((d) => completeYears.has(d.year));

  // Data-coverage summary for the stacked area (union of all observed years)
  const allObservedYears = [
    ...new Set([...govtYears, ...privYears, ...extYears]),
  ].sort((a, b) => a - b);
  const completeSorted = [...completeYears].sort((a, b) => a - b);
  const earliest = allObservedYears[0];
  const latest = allObservedYears[allObservedYears.length - 1];
  const span = earliest && latest ? latest - earliest + 1 : 0;
  const missingYears = span - completeSorted.length;
  const coverageLabel =
    completeSorted.length === 0
      ? `No years have complete GGHE-D + PVT-D + EXT data for this country`
      : `${completeSorted.length} of ${span} years (${earliest}–${latest}) have data for every segment shown${missingYears > 0 ? ` — ${missingYears} year${missingYears === 1 ? "" : "s"} partial/missing` : ""}`;

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Health Financing Landscape"
        question="How much is spent on health, and who pays?"
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
          label="Health spending (% of GDP)"
          value={getLatest(cheGDP)}
          unit="%"
          previousValue={getPrevious(cheGDP)}
          year={getLatestYear(cheGDP)}
          previousYear={getPreviousYear(cheGDP)}
          source="WHO GHED"
          info={{
            title: "Current health expenditure (% of GDP)",
            description:
              "Total current health expenditure from government, households, private sources, and external partners, shown as a share of GDP.",
            source: "WHO Global Health Expenditure Database (GHED)",
            interpretation:
              "Indicates the share of national economic output allocated to health. Low- and middle-income countries typically fall between 4–7%; high-income countries between 8–12%.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="Health spending per person (US$)"
          value={getLatest(chePC)}
          unit="$"
          previousValue={getPrevious(chePC)}
          year={getLatestYear(chePC)}
          previousYear={getPreviousYear(chePC)}
          source="WHO GHED"
          info={{
            title: "Current health expenditure per person (current US$)",
            description:
              "Total health spending per person in current US dollars. Use constant-dollar trends when comparing real change over time.",
            source: "WHO Global Health Expenditure Database (GHED)",
            interpretation:
              "Represents the absolute level of health resources available per person. Values are sensitive to currency fluctuations; constant-USD figures provide a more stable measure of real resource change over time.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="Government share of health spending"
          value={getLatest(govt)}
          unit="%"
          previousValue={getPrevious(govt)}
          year={getLatestYear(govt)}
          previousYear={getPreviousYear(govt)}
          source="WHO GHED"
          colorClass="text-[var(--color-govt)]"
          info={{
            title: "Government share of current health expenditure",
            description:
              "Proportion of current health expenditure financed by domestic government sources, including central and subnational government budgets (GGHE-D).",
            source: "WHO Global Health Expenditure Database (GHED)",
            interpretation:
              "A higher share usually means stronger pooling through public financing. A falling share can signal fiscal pressure or rising household/private financing.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="Out-of-pocket share of health spending"
          value={getLatest(oop)}
          unit="%"
          previousValue={getPrevious(oop)}
          year={getLatestYear(oop)}
          previousYear={getPreviousYear(oop)}
          source="WHO GHED"
          colorClass="text-[var(--color-oop)]"
          info={{
            title: "Out-of-pocket share of current health expenditure",
            description:
              "Share of current health expenditure paid directly by households at the point of care, without insurance reimbursement.",
            source: "WHO Global Health Expenditure Database (GHED)",
            interpretation:
              "OOP above about 20% of current health expenditure is a commonly used warning sign for financial-protection risk; country context still matters. High shares are associated with catastrophic health spending and foregone care among lower-income households.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
      </KpiRow>

      {/* Primary: Stacked area chart */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex items-start gap-1.5">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">
                Who pays for current health expenditure?
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                SHA 2011 financing sources: government, external, and domestic private financing sum to 100%.
              </p>
            </div>
            <InfoTooltip
              title="Health Financing Sources (SHA 2011 decomposition)"
              description="Composition of current health expenditure by financing source under the System of Health Accounts (SHA 2011) framework. Government (GGHE-D), external resources, and domestic private financing are mutually exclusive and collectively sum to 100%."
              source="WHO Global Health Expenditure Database (GHED)"
              interpretation="Changes in the financing mix over time reflect structural transitions in health system development. A rising government share typically accompanies moves toward universal coverage; a rising private share may indicate public financing constraints."
              referenceUrl="https://apps.who.int/nha/database"
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            Source: WHO GHED
          </span>
        </div>
        <div className="h-[400px]">
          <StackedAreaChart
            className="h-full"
            series={[
              {
                name: "Government (GGHE-D)",
                data: govtStack,
                colorKey: "govt",
                source: "WHO GHED",
              },
              {
                name: "External resources",
                data: extStack,
                colorKey: "external",
                source: "WHO GHED",
              },
              {
                name: "Domestic private, including OOP",
                data: privStack,
                colorKey: "private",
                source: "WHO GHED",
              },
            ]}
            overlay={
              chePC.length > 0
                ? {
                    name: "CHE per capita",
                    data: chePC,
                    unit: "USD",
                    source: "WHO GHED",
                  }
                : undefined
            }
          />
        </div>
        {/* Data coverage indicator */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              completeSorted.length === 0
                ? "bg-red-500"
                : missingYears === 0
                  ? "bg-emerald-500"
                  : "bg-amber-500"
            }`}
            aria-hidden
          />
          <span>{coverageLabel}</span>
          {completeSorted.length > 0 && completeSorted.length < 10 && (
            <span className="text-muted-foreground/70">
              · Years shown: {completeSorted.join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* Secondary charts */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Fiscal priority: Govt health % GGE vs Abuja 15% target */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Government Health Expenditure (% of General Government Expenditure)
              </h2>
              <InfoTooltip
                title="Government Health Expenditure (% of General Government Expenditure)"
                description="Domestic government health expenditure expressed as a share of total general government expenditure. Indicates the fiscal priority assigned to health within overall public spending."
                source="WHO Global Health Expenditure Database (GHED)"
                interpretation="The 2001 Abuja Declaration established a 15% target for African Union member states. Values below 8% typically indicate that health receives a lower share of public resources relative to other sectors."
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
                  name: "Govt health exp (% GGE)",
                  data: govtGGE,
                  color: FINANCING_COLORS.govt,
                  hoverValue: "%{y:.1f}%",
                },
              ]}
              benchmark={{
                value: 15,
                label: "Abuja target (15%)",
                color: "#ef4444",
                unit: "%",
              }}
              peerBand={
                showPeers && bands?.["GHED_gghed_gge"]
                  ? {
                      data: bands["GHED_gghed_gge"],
                      incomeGroup: incomeGroup!,
                      color: FINANCING_COLORS.govt,
                    }
                  : undefined
              }
              yAxisTitle="% of general govt expenditure"
            />
          </div>
          <DataCoverage series={[govtGGE]} />
        </div>

        {/* Quality of financing: pooled/pre-paid (CFA) vs OOP */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  Pooled financing vs household payments
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Compulsory Financing Arrangements (CFA) · Out-of-Pocket (OOP)
                </p>
              </div>
              <InfoTooltip
                title="Compulsory financing and out-of-pocket payments"
                description="Compulsory Financing Arrangements (CFA) encompass government health schemes and mandatory insurance — mechanisms that pool risk across the population. Out-of-pocket expenditure represents direct payments by households at point of care."
                source="WHO Global Health Expenditure Database (GHED)"
                interpretation="When compulsory or pooled financing rises and OOP falls, households are better protected from paying at the point of care."
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
                  color: FINANCING_COLORS.govt,
                  hoverValue: "%{y:.1f}%",
                },
                {
                  name: "Out-of-pocket (OOP)",
                  data: oop,
                  color: FINANCING_COLORS.oop,
                  hoverValue: "%{y:.1f}%",
                },
              ]}
              peerBand={
                showPeers && bands?.["GHED_oops_che"]
                  ? {
                      data: bands["GHED_oops_che"],
                      incomeGroup: incomeGroup!,
                      color: FINANCING_COLORS.oop,
                    }
                  : undefined
              }
              yAxisTitle="% of CHE"
            />
          </div>
          <DataCoverage series={[cfa, oop]} />
        </div>

        {/* Real spending per capita (constant 2023 USD) */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  Real health spending per person
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Inflation-adjusted, constant 2023 US$
                </p>
              </div>
              <InfoTooltip
                title="Real health spending per person (constant 2023 US$)"
                description="Total health spending per person expressed in constant 2023 US dollars, adjusting for inflation and removing exchange-rate variation."
                source="WHO Global Health Expenditure Database (GHED)"
                interpretation="Inflation-adjusted spending per capita provides a measure of real resource changes over time. It distinguishes genuine increases in health system resources from nominal growth driven by price changes or currency movements."
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
                  name: "CHE per capita (constant 2023 USD)",
                  data: chePCReal,
                  color: FINANCING_COLORS.total,
                  hoverValue: "$%{y:,.0f}",
                },
              ]}
              peerBand={
                showPeers && bands?.["GHED_che_usd2023_pc"]
                  ? {
                      data: bands["GHED_che_usd2023_pc"],
                      incomeGroup: incomeGroup!,
                      color: FINANCING_COLORS.total,
                    }
                  : undefined
              }
              yAxisTitle="USD per capita (constant 2023)"
            />
          </div>
          <DataCoverage series={[chePCReal]} />
        </div>
      </div>

      {/* Macro context: GDP per capita + GDP growth */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  GDP Per Capita (current USD)
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Nominal — IMF World Economic Outlook
                </p>
              </div>
              <InfoTooltip
                title="GDP per capita (current USD)"
                description="Nominal GDP per person in current US dollars. Reflects the overall economic size available per capita at market exchange rates."
                source="IMF World Economic Outlook (WEO)"
                interpretation="Provides macroeconomic context for health expenditure levels. Countries at similar income levels can show very different health spending priorities, making GDP per capita an essential denominator for cross-country comparisons."
                referenceUrl="https://www.imf.org/en/Publications/WEO"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              IMF WEO
            </span>
          </div>
          <div className="h-[220px]">
            <TimeSeriesChart
              className="h-full"
              lines={[
                {
                  name: "GDP per capita",
                  data: gdpPC,
                  color: FINANCING_COLORS.total,
                  hoverValue: "$%{y:,.0f}",
                  mode: "lines+markers",
                },
              ]}
              yAxisTitle="USD per capita"
            />
          </div>
          <DataCoverage series={[gdpPC]} />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  GDP Growth Rate (annual %)
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Real GDP growth — IMF World Economic Outlook
                </p>
              </div>
              <InfoTooltip
                title="GDP growth rate (annual %)"
                description="Annual percentage change in real GDP. Reflects the pace of economic expansion or contraction in a given year."
                source="IMF World Economic Outlook (WEO)"
                interpretation="Sustained positive growth typically expands the fiscal space available for public spending. Periods of contraction often precede or accompany declines in real health expenditure."
                referenceUrl="https://www.imf.org/en/Publications/WEO"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              IMF WEO
            </span>
          </div>
          <div className="h-[220px]">
            <TimeSeriesChart
              className="h-full"
              lines={[
                {
                  name: "GDP growth",
                  data: gdpGrowth,
                  color: "#0d9488",
                  hoverValue: "%{y:.1f}%",
                  mode: "lines+markers",
                },
              ]}
              benchmark={{ value: 0, label: "0%", color: "#9ca3af", unit: "%" }}
              yAxisTitle="Annual growth (%)"
            />
          </div>
          <DataCoverage series={[gdpGrowth]} />
        </div>
      </div>
    </div>
  );
}
