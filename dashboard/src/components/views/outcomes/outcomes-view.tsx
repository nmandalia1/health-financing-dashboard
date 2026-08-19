"use client";

import { useState } from "react";
import { ViewHeader } from "@/components/ui/view-header";
import { KpiRow } from "@/components/kpi/kpi-row";
import { KpiRowSkeleton } from "@/components/kpi/kpi-row-skeleton";
import { KpiCard } from "@/components/kpi/kpi-card";
import { ScatterChart } from "@/components/charts/scatter-chart";
import { AnimatedScatterChart } from "@/components/charts/animated-scatter-chart";
import { RadarChart } from "@/components/charts/radar-chart";
import {
  useScatterData,
  useAnimatedScatterData,
  useRadarData,
  OUTCOME_OPTIONS,
} from "@/hooks/use-outcomes-data";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DataCoverage } from "@/components/ui/data-coverage";
import { YearRangePicker } from "@/components/ui/year-range-picker";

const UHC_RADAR_LABELS: Record<string, string> = {
  UHC_SCI_RMNCH: "RMNCH",
  UHC_SCI_INFECT: "Infectious\nDisease",
  UHC_SCI_NCD: "NCDs",
};

export function OutcomesView({ iso3 }: { iso3: string }) {
  const [selectedOutcome, setSelectedOutcome] = useState<string>(
    OUTCOME_OPTIONS[0].code
  );
  const [animated, setAnimated] = useState(false);
  const currentOption = OUTCOME_OPTIONS.find(
    (o) => o.code === selectedOutcome
  )!;

  const { data: scatterData, isLoading: scatterLoading } =
    useScatterData(selectedOutcome);
  const { data: animatedData, isLoading: animatedLoading } =
    useAnimatedScatterData(selectedOutcome, animated);
  const { data: radarData, isLoading: radarLoading } = useRadarData(iso3);

  // Extract KPI values from scatter data for the selected country
  const countryPoint = scatterData.find((p) => p.iso3 === iso3);

  // Build radar arms from latest values
  const radarArms = radarData
    ? Object.entries(UHC_RADAR_LABELS).map(([code, label]) => {
        const series = radarData[code];
        const latest = series && series.length > 0 ? series[series.length - 1].value : 0;
        return { label, value: latest };
      })
    : [];

  const isLoading = scatterLoading || radarLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <ViewHeader
          title="Health Outcomes & Value for Money"
          question="How do health outcomes compare with spending levels?"
        />
        <KpiRowSkeleton count={2} />
        <KpiRowSkeleton count={3} />
        <div className="h-[400px] animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Health Outcomes & Value for Money"
        question="What are we getting for the money spent?"
      >
        <YearRangePicker />
        <select
          value={selectedOutcome}
          onChange={(e) => setSelectedOutcome(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          {OUTCOME_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.label}
            </option>
          ))}
        </select>
      </ViewHeader>

      {/* KPI Row 1: Spending + selected outcome */}
      <KpiRow>
        <KpiCard
          label="Health Expenditure Per Capita (USD)"
          value={countryPoint?.x ?? null}
          unit="$"
          info={{
            title: "Current Health Expenditure per capita (current USD)",
            description:
              "Total health spending per person in current US dollars, encompassing government, private, and external sources.",
            source: "WHO Global Health Expenditure Database (GHED)",
            interpretation:
              "Represents the absolute level of financial resources available for health per person. Cross-country comparisons require caution given purchasing power differences.",
            referenceUrl: "https://apps.who.int/nha/database",
          }}
        />
        <KpiCard
          label={currentOption.label}
          value={countryPoint?.y ?? null}
          info={{
            title: currentOption.label,
            description:
              "Shows the selected population health outcome. Use it with spending per person to compare outcomes achieved at similar spending levels.",
            source: "WHO / World Bank (varies by indicator)",
            interpretation:
              "Countries with similar spending levels can achieve markedly different outcomes, reflecting differences in system efficiency, allocation, and population health determinants.",
          }}
        />
      </KpiRow>

      {/* KPI Row 2: UHC Service Coverage — all 3 sub-indices */}
      <KpiRow>
        <KpiCard
          label="UHC — RMNCH Sub-index (0–100)"
          value={radarArms[0]?.value ?? null}
          info={{
            title: "UHC Service Coverage — RMNCH Sub-index (0–100)",
            description:
              "Composite score of tracer service coverage for Reproductive, Maternal, Newborn and Child Health, including family planning, antenatal care, skilled birth attendance, and childhood immunization.",
            source: "WHO UHC Service Coverage Index",
            interpretation:
              "A higher score means broader tracer-service coverage; 100 represents the top of the index scale, not necessarily perfect real-world access.",
            referenceUrl: "https://www.who.int/data/gho/data/themes/universal-health-coverage",
          }}
        />
        <KpiCard
          label="UHC — Infectious Disease Sub-index (0–100)"
          value={radarArms[1]?.value ?? null}
          info={{
            title: "UHC Service Coverage — Infectious Disease Sub-index (0–100)",
            description:
              "Composite score of tracer service coverage for infectious disease prevention and treatment, including tuberculosis, HIV/AIDS, and malaria interventions.",
            source: "WHO UHC Service Coverage Index",
            interpretation:
              "Captures coverage of priority communicable disease services. Low scores indicate gaps in treatment access or preventive service delivery for major infectious diseases.",
            referenceUrl: "https://www.who.int/data/gho/data/themes/universal-health-coverage",
          }}
        />
        <KpiCard
          label="UHC — NCD Sub-index (0–100)"
          value={radarArms[2]?.value ?? null}
          info={{
            title: "UHC Service Coverage — Non-Communicable Disease Sub-index (0–100)",
            description:
              "Composite score of tracer service coverage for non-communicable diseases, including cardiovascular disease, diabetes, cancer, and mental health services.",
            source: "WHO UHC Service Coverage Index",
            interpretation:
              "The NCD sub-index is commonly the weakest dimension in lower-income countries, reflecting the early stage of health system adaptation to the rising burden of chronic disease.",
            referenceUrl: "https://www.who.int/data/gho/data/themes/universal-health-coverage",
          }}
        />
      </KpiRow>

      {/* Efficiency scatter */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5">
            <h2 className="text-sm font-medium text-muted-foreground">
              Health Expenditure vs. Outcome — Cross-Country Comparison
            </h2>
            <InfoTooltip
              title="Health Expenditure vs. Outcome (cross-country)"
              description="Each point represents one country in the latest available year. The x-axis shows current health expenditure per capita (USD, log scale); the y-axis shows the selected health outcome metric. Countries are coloured by World Bank income group."
              source="WHO Global Health Expenditure Database (GHED); WHO and World Bank outcome indicators"
              interpretation="This comparison illustrates how health outcomes vary across countries at different levels of health spending. Countries with better outcomes at similar spending levels may have stronger service delivery, allocation, prevention, or broader social determinants."
              referenceUrl="https://apps.who.int/nha/database"
            />
          </div>
          <div
            role="group"
            className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5"
          >
            <button
              type="button"
              onClick={() => setAnimated(false)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                !animated
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Latest year
            </button>
            <button
              type="button"
              onClick={() => setAnimated(true)}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                animated
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Play className="h-3 w-3" />
              Animate 2000–2023
            </button>
          </div>
        </div>
        <DataCoverage series={[]} customLabel={`${scatterData.length} countries have data for the selected indicators`} />
        <div className="h-[480px]">
          {animated ? (
            animatedLoading || animatedData.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                {animatedLoading ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
                    <div className="text-xs text-muted-foreground">
                      Loading year-by-year data…
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No time-series data available for this outcome.
                  </p>
                )}
              </div>
            ) : (
              <AnimatedScatterChart
                className="h-full"
                data={animatedData}
                highlightIso3={iso3}
                xLabel="Current Health Expenditure per Capita (USD)"
                yLabel={currentOption.label}
                xLog
                benchmarkY={
                  selectedOutcome === "UHC_INDEX_REPORTED"
                    ? { value: 80, label: "WHO high-coverage reference (80)" }
                    : undefined
                }
              />
            )
          ) : (
            <ScatterChart
              className="h-full"
              data={scatterData}
              highlightIso3={iso3}
              xLabel="CHE per capita (USD)"
              yLabel={currentOption.label}
              xLog
              benchmarkY={
                selectedOutcome === "UHC_INDEX_REPORTED"
                  ? { value: 80, label: "WHO high-coverage reference (80)" }
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {/* UHC Radar */}
      {radarArms.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start gap-1.5">
            <h2 className="text-sm font-medium text-muted-foreground">
              UHC Service Coverage Sub-index Profile
            </h2>
            <InfoTooltip
              title="UHC Service Coverage — Sub-index Profile"
              description="Three sub-indices of the WHO UHC Service Coverage Index, each scored 0–100: RMNCH (reproductive, maternal, newborn and child health), Infectious Disease, and NCDs (non-communicable diseases)."
              source="WHO UHC Service Coverage Index"
              interpretation="Variation across sub-indices indicates uneven coverage across different health service domains. Low NCD scores are common in lower-income settings where health systems are still expanding beyond communicable disease and maternal health services."
              referenceUrl="https://www.who.int/data/gho/data/themes/universal-health-coverage"
            />
          </div>
          <div className="mx-auto h-[350px] max-w-lg">
            <RadarChart className="h-full" arms={radarArms} />
          </div>
          <DataCoverage series={[]} customLabel={`${radarArms.filter((a) => a.value !== 0).length} of ${radarArms.length} UHC sub-indices have data`} />
        </div>
      )}
    </div>
  );
}
