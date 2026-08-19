"use client";

import { useState } from "react";
import { usePhcData } from "@/hooks/use-phc-data";
import { usePeerBenchmarks } from "@/hooks/use-peer-benchmarks";
import { ViewHeader } from "@/components/ui/view-header";
import { YearRangePicker } from "@/components/ui/year-range-picker";
import { useYearRange } from "@/lib/year-range-context";
import { filterByYears } from "@/lib/filter-years";
import { BenchmarkToggle } from "@/components/ui/benchmark-toggle";
import { KpiRow } from "@/components/kpi/kpi-row";
import { KpiRowSkeleton } from "@/components/kpi/kpi-row-skeleton";
import { KpiCard } from "@/components/kpi/kpi-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { makeBandTraces } from "@/lib/peer-band-utils";
import type { Data } from "plotly.js-dist-min";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DataCoverage } from "@/components/ui/data-coverage";

const PEER_INDICATORS = [
  "GHED_phc_usd_pc",  // PHC spending per capita hero chart
  "HWF_0001",         // Doctors per 10,000
  "HWF_0006",         // Pharmacists per 10,000
];

// ---------------------------------------------------------------------------
// Helpers
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
// PhcView
// ---------------------------------------------------------------------------

export function PhcView({ iso3 }: { iso3: string }) {
  const { data, isLoading } = usePhcData(iso3);
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
          title="Primary Health Care & Service Delivery"
          question="Is financing supporting front-line service delivery?"
        />
        <KpiRowSkeleton />
        <div className="h-[280px] animate-pulse rounded-lg border bg-muted" />
        <div className="h-[280px] animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  const f = (key: string) => filterByYears(data[key] || [], startYear, endYear);

  const phcPC = f("GHED_phc_usd_pc");
  const phcCHE = f("GHED_phc_che");
  const govtPHC = f("GHED_gghed_phc_phc");
  const doctors = f("HWF_0001");
  const nurses = f("HWF_0007");
  const dentists = f("HWF_0004");
  const pharmacists = f("HWF_0006");
  const beds = f("SH.MED.BEDS.ZS");
  const sba = f("WHS4_543");
  const anc1 = f("WHS4_100");
  const anc4 = f("WHS4_544");

  // KPI values
  const latestPhcPC = getLatest(phcPC);
  const latestPhcCHE = getLatest(phcCHE);
  const latestDoctors = getLatest(doctors);
  const latestNurses = getLatest(nurses);   // absolute headcount in WHO GHO
  const latestDentists = getLatest(dentists); // absolute headcount in WHO GHO
  const latestPharmacists = getLatest(pharmacists);

  // PHC spending bar chart data
  const phcYears = phcPC.map((d) => d.year);
  const phcValues = phcPC.map((d) => d.value);
  const phcBarColors = phcValues.map((v) => (v >= 86 ? "#10b981" : "#f59e0b"));

  const phcBarTrace: Data = {
    type: "bar",
    x: phcYears,
    y: phcValues,
    name: "PHC per capita (USD)",
    marker: { color: phcBarColors },
    hovertemplate: "%{x}: $%{y:.0f}<extra>PHC per capita</extra>",
  };

  // Peer band traces for PHC bar chart (line overlay on bar chart)
  const phcBandTraces: Data[] =
    showPeers && bands?.["GHED_phc_usd_pc"]
      ? makeBandTraces(bands["GHED_phc_usd_pc"], {
          incomeGroup: incomeGroup!,
          color: "#6b7280",
        })
      : [];

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Primary Health Care & Service Delivery"
        question="Is money reaching the front lines?"
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
          label="PHC spending per person (US$)"
          value={latestPhcPC}
          unit="$"
          previousValue={getPrevious(phcPC)}
          year={getLatestYear(phcPC)}
          previousYear={getPreviousYear(phcPC)}
          source="WHO GHED"
          info={{
            title: "Primary health care spending per person (US$)",
            description:
              "Annual spending on primary health care functions per person, in current US dollars. PHC encompasses first-contact, continuous, and coordinated care services.",
            source: "WHO Global Health Expenditure Database (GHED)",
            interpretation:
              "The US$86 figure is a commonly cited minimum-cost reference for an essential PHC package; it should be treated as an order-of-magnitude benchmark.",
            referenceUrl: "https://www.who.int/publications/i/item/9789240017269",
          }}
        />
        <KpiCard
          label="PHC Expenditure (% of CHE)"
          value={latestPhcCHE}
          unit="%"
          previousValue={getPrevious(phcCHE)}
          year={getLatestYear(phcCHE)}
          previousYear={getPreviousYear(phcCHE)}
          source="WHO GHED"
          info={{
            title: "PHC Expenditure as a Share of Current Health Expenditure (%)",
            description:
              "Proportion of total current health expenditure allocated to primary health care functions, as opposed to hospital-based or specialist services.",
            source: "WHO Global Health Expenditure Database (GHED)",
            interpretation:
              "A higher PHC share reflects greater allocative emphasis on front-line care. Health systems that prioritise PHC typically achieve broader population coverage at lower per-capita cost.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="Government Share of PHC Expenditure (%)"
          value={getLatest(govtPHC)}
          unit="%"
          previousValue={getPrevious(govtPHC)}
          year={getLatestYear(govtPHC)}
          previousYear={getPreviousYear(govtPHC)}
          source="WHO GHED"
          colorClass="text-[var(--color-govt)]"
          info={{
            title: "Government Share of Primary Health Care Expenditure (%)",
            description:
              "Proportion of total PHC spending financed by domestic government sources, as distinct from out-of-pocket, private insurance, or external donor funding.",
            source: "WHO Global Health Expenditure Database (GHED)",
            interpretation:
              "A high government share of PHC expenditure indicates strong public financing of front-line services, which is associated with equitable access across income groups. When households finance PHC primarily through out-of-pocket payments, lower-income groups are more likely to forgo care.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label="Medical Doctors per 10,000 Population"
          value={latestDoctors}
          unit=""
          previousValue={getPrevious(doctors)}
          year={getLatestYear(doctors)}
          previousYear={getPreviousYear(doctors)}
          source="WHO GHO"
          info={{
            title: "Medical Doctors per 10,000 Population",
            description:
              "Density of licensed and practicing medical doctors per 10,000 population, including both generalists and specialists.",
            source: "WHO Global Health Observatory",
            interpretation:
              "Physician density is a proxy for service availability. A combined threshold of 4.45 doctors, nurses and midwives per 1,000 population is associated with the attainment of basic health coverage targets.",
            referenceUrl: "https://www.who.int/data/gho/data/indicators/indicator-details/GHO/medical-doctors-(per-10-000-population)",
          }}
        />
      </KpiRow>

      {/* PHC data availability callout */}
      {latestPhcPC === null && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          PHC expenditure data not available for this country. Showing workforce
          and service delivery indicators.
        </div>
      )}

      {/* Workforce section */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5">
            <h2 className="text-sm font-medium text-muted-foreground">
              Health Workforce Density (per 10,000 population)
            </h2>
            <InfoTooltip
              title="Health Workforce Density (per 10,000 population)"
              description="Medical doctors and pharmacists per 10,000 population, reported to the WHO Global Health Observatory. Nurses and midwives are shown separately where only headcounts are available. Each cadre is shown as a time series to illustrate change over time."
              source="WHO Global Health Observatory"
              interpretation="Workforce density constrains the volume and quality of services a health system can deliver. Low physician or pharmacist density limits access to diagnosis, treatment, and medicines, irrespective of available funding."
              referenceUrl="https://www.who.int/data/gho"
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            WHO GHO
          </span>
        </div>
        <div className="h-[260px]">
          <TimeSeriesChart
            className="h-full"
            lines={[
              {
                name: "Medical doctors",
                data: doctors,
                color: "#2563eb",
                hoverValue: "%{y:.2f} per 10,000",
                mode: "lines+markers",
              },
              {
                name: "Pharmacists",
                data: pharmacists,
                color: "#0d9488",
                hoverValue: "%{y:.2f} per 10,000",
                mode: "lines+markers",
              },
            ]}
            yAxisTitle="per 10,000 population"
          />
        </div>
        <DataCoverage series={[doctors, pharmacists]} />
        {/* Headcount totals — WHO GHO stores these as absolute counts, not rates */}
        {(latestNurses !== null || latestDentists !== null) && (
          <div className="mt-4 border-t pt-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Absolute headcounts (WHO GHO reports these as national totals, not density rates)
            </p>
            <div className="grid grid-cols-2 gap-4">
              {latestNurses !== null && (
                <div>
                  <p className="text-sm font-medium">Nurses &amp; midwives</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {latestNurses.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">total national workforce</p>
                </div>
              )}
              {latestDentists !== null && (
                <div>
                  <p className="text-sm font-medium">Dentists</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {latestDentists.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">total national workforce</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* PHC spending hero chart */}
      {phcPC.length > 0 ? (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  PHC expenditure per capita
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Reference line: US$86 per person
                </p>
              </div>
              <InfoTooltip
                title="PHC Expenditure Per Capita (USD) — Annual Trend"
                description="Year-by-year primary health care spending per person in current US dollars. Bars are shaded amber when below the WHO minimum benchmark of USD 86, and green when at or above it."
                source="WHO Global Health Expenditure Database (GHED)"
                interpretation="The US$86 figure is a commonly cited minimum-cost reference for an essential PHC package; treat it as an order-of-magnitude benchmark. Sustained shortfalls can indicate under-resourcing of front-line services."
                referenceUrl="https://www.who.int/publications/i/item/9789240017269"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              WHO GHED
            </span>
          </div>
          <div className="h-[280px]">
            <PlotlyChart
              className="h-full"
              data={[...phcBandTraces, phcBarTrace]}
              layout={{
                shapes: [
                  {
                    type: "line",
                    x0: 0,
                    x1: 1,
                    xref: "paper",
                    y0: 86,
                    y1: 86,
                    yref: "y",
                    line: { color: "#ef4444", width: 1.5, dash: "dash" },
                  },
                ],
                annotations: [
                  {
                    x: 1,
                    xref: "paper",
                    y: 86,
                    yref: "y",
                    text: "WHO min ($86)",
                    showarrow: false,
                    xanchor: "right",
                    yanchor: "bottom",
                    font: { size: 11, color: "#ef4444" },
                  },
                ],
                yaxis: { title: { text: "USD per capita" }, tickprefix: "$" },
                xaxis: { title: { text: "Year" }, dtick: 2 },
                hovermode: "x unified" as const,
              }}
            />
          </div>
          <DataCoverage series={[phcPC]} />
        </div>
      ) : null}

      {/* Service delivery chart */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">
                Maternal and Newborn Care Coverage (%)
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                Antenatal care visits and skilled birth attendance
              </p>
            </div>
            <InfoTooltip
              title="Maternal and Newborn Care Coverage (%)"
              description="Coverage rates for three maternal health service indicators: antenatal care with at least 1 visit (ANC1), at least 4 visits (ANC4), and births attended by a skilled health professional (SBA). ANC4 remains useful for trends, although WHO now recommends eight antenatal contacts."
              source="WHO Global Health Observatory; DHS/MICS household surveys"
              interpretation="The difference between ANC1 and ANC4 coverage reveals dropout in continuity of antenatal care. Skilled birth attendance is a key structural determinant of maternal and neonatal mortality outcomes."
              referenceUrl="https://www.who.int/data/gho"
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            WHO GHO
          </span>
        </div>
        <div className="h-[280px]">
          <TimeSeriesChart
            className="h-full"
            lines={[
              { name: "ANC ≥1 visit", data: anc1, color: "#93c5fd", dash: "solid", hoverValue: "%{y:.1f}%" },
              { name: "ANC ≥4 visits", data: anc4, color: "#3b82f6", dash: "solid", hoverValue: "%{y:.1f}%" },
              {
                name: "Skilled birth attendance",
                data: sba,
                color: "#1d4ed8",
                dash: "solid",
                hoverValue: "%{y:.1f}%",
              },
            ]}
            yAxisTitle="Coverage (%)"
            benchmark={{ value: 90, label: "90% coverage target", color: "#9ca3af", unit: "%" }}
          />
        </div>
        <DataCoverage series={[anc1, anc4, sba]} />
      </div>

      {/* Hospital beds + govt PHC share */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Hospital beds */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Hospital beds
              </h2>
              <InfoTooltip
                title="Hospital beds per 1,000 population"
                description="Total inpatient beds available in public, private, general and specialized hospitals and rehabilitation centres."
                source="World Bank / WHO"
                interpretation="A proxy for inpatient capacity. LMICs typically sit below 2 per 1,000; OECD average is closer to 5. Declining trends may signal pressure on inpatient access unless balanced by stronger outpatient and PHC capacity."
                referenceUrl="https://data.worldbank.org/indicator/SH.MED.BEDS.ZS"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              World Bank
            </span>
          </div>
          <div className="h-[280px]">
            <TimeSeriesChart
              className="h-full"
              lines={[
                {
                  name: "Hospital beds",
                  data: beds,
                  color: "#2563eb",
                  dash: "solid",
                  hoverValue: "%{y:.1f} per 1,000",
                },
              ]}
              yAxisTitle="per 1,000 population"
            />
          </div>
          <DataCoverage series={[beds]} />
        </div>

        {/* Govt PHC share */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Government share of PHC expenditure
              </h2>
              <InfoTooltip
                title="Government share of PHC expenditure"
                description="Share of total PHC spending financed by government sources (as opposed to OOP, private insurance, or external funding)."
                source="WHO GHED"
                interpretation="High government share of PHC = strong pooling at the level most critical for access. When households finance PHC directly, poorer populations forgo first-contact care."
                referenceUrl="https://apps.who.int/nha/database"
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              WHO GHED
            </span>
          </div>
          {govtPHC.length > 0 ? (
            <>
              <div className="h-[280px]">
                <TimeSeriesChart
                  className="h-full"
                  lines={[
                    {
                      name: "Govt share of PHC",
                      data: govtPHC,
                      color: "#2563eb",
                      dash: "solid",
                      hoverValue: "%{y:.1f}%",
                    },
                  ]}
                  yAxisTitle="% of PHC expenditure"
                />
              </div>
              <DataCoverage series={[govtPHC]} />
            </>
          ) : (
            <div className="flex h-[280px] items-center justify-center rounded-lg bg-muted/40">
              <p className="text-sm text-muted-foreground">
                Govt PHC share data not available
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
