"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Activity,
  Coins,
  HandCoins,
  HeartPulse,
  Landmark,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { ChoroplethMap } from "@/components/charts/choropleth-map";
import { useChoropleth } from "@/hooks/use-choropleth";
import { useCountries } from "@/hooks/use-countries";
import { cn } from "@/lib/utils";

interface MapMetric {
  code: string;
  /** Plain-English label for the pill button */
  label: string;
  /** Subtitle shown under the map */
  fullName: string;
  /** Unit suffix in tooltip */
  unit: string;
  /** Plotly colorscale name or stops */
  colorscale: string | Array<[number, string]>;
  reverseScale?: boolean;
  /** Short sentence under the map */
  description: string;
  /** Route suffix appended to /country/[iso3] when a country is clicked */
  routeSuffix: string;
  icon: LucideIcon;
  accent: string;
}

const METRICS: MapMetric[] = [
  {
    code: "GHED_CHEGDP_SHA2011",
    label: "Health share of GDP",
    fullName: "Current health expenditure (% of GDP)",
    unit: "%",
    colorscale: [
      [0, "#eff6ff"],
      [0.5, "#60a5fa"],
      [1, "#1e3a8a"],
    ],
    reverseScale: true,
    description:
      "Total health spending as a share of GDP. Darker countries spend a smaller share of national income on health.",
    routeSuffix: "",
    icon: Activity,
    accent: "text-govt",
  },
  {
    code: "GHED_CHE_pc_US_SHA2011",
    label: "Health spending per person",
    fullName: "Health spending per capita (USD)",
    unit: " USD",
    colorscale: [
      [0, "#f5f3ff"],
      [0.5, "#a78bfa"],
      [1, "#4c1d95"],
    ],
    reverseScale: true,
    description:
      "Health spending per person in current US dollars. Darker countries have lower spending per person.",
    routeSuffix: "",
    icon: Coins,
    accent: "text-violet-600",
  },
  {
    code: "GHED_OOPSCHE_SHA2011",
    label: "Household payments",
    fullName: "Out-of-pocket share of health spending",
    unit: "%",
    colorscale: [
      [0, "#fef3c7"],
      [0.5, "#f59e0b"],
      [1, "#7c2d12"],
    ],
    description:
      "Share of health spending paid directly by households. The 20% line is a financial-protection watch point, not a guarantee of safety.",
    routeSuffix: "/protection",
    icon: HandCoins,
    accent: "text-oop",
  },
  {
    code: "GHED_GGHE-DGGE_SHA2011",
    label: "Government priority",
    fullName: "Government health spending (% of government budget)",
    unit: "%",
    colorscale: [
      [0, "#ecfdf5"],
      [0.5, "#34d399"],
      [1, "#064e3b"],
    ],
    reverseScale: true,
    description:
      "Share of the government budget allocated to health. The Abuja 15% target applies to African Union members; elsewhere it is a useful reference point.",
    routeSuffix: "/fiscal",
    icon: Landmark,
    accent: "text-emerald-600",
  },
  {
    code: "WHOSIS_000001",
    label: "Life expectancy",
    fullName: "Life expectancy at birth (years)",
    unit: " yrs",
    colorscale: [
      [0, "#fee2e2"],
      [0.5, "#fb923c"],
      [1, "#14532d"],
    ],
    reverseScale: true,
    description:
      "Life expectancy at birth, both sexes combined. Darker = shorter lives.",
    routeSuffix: "/outcomes",
    icon: HeartPulse,
    accent: "text-rose-600",
  },
  {
    code: "UHC_INDEX_REPORTED",
    label: "Service coverage",
    fullName: "UHC Service Coverage Index (0–100)",
    unit: "",
    colorscale: [
      [0, "#f0fdfa"],
      [0.5, "#2dd4bf"],
      [1, "#134e4a"],
    ],
    reverseScale: true,
    description:
      "WHO/World Bank index of essential health service coverage. Darker = weaker coverage. A score of 80 is commonly used as a high-coverage reference point; SDG 3.8 calls for universal health coverage.",
    routeSuffix: "/outcomes",
    icon: ShieldCheck,
    accent: "text-external",
  },
];

export function WorldMap() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlMetric = searchParams.get("metric");
  const initialMetric =
    urlMetric && METRICS.some((m) => m.code === urlMetric)
      ? urlMetric
      : METRICS[0].code;
  const [metricCode, setMetricCode] = useState(initialMetric);

  // Keep URL in sync with selection (shareable links, back/forward friendly).
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (metricCode === METRICS[0].code) params.delete("metric");
    else params.set("metric", metricCode);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricCode]);

  const metric = useMemo(
    () => METRICS.find((m) => m.code === metricCode) ?? METRICS[0],
    [metricCode]
  );
  const { data, isLoading } = useChoropleth(metric.code);
  const { countries } = useCountries();

  // Coverage differs by indicator (168 countries here, 172 there), so a country
  // that is clickable on one map would be inert on the next. Everything the
  // indicator has no value for is handed to the map as a "no data" layer rather
  // than being dropped, so every country stays hoverable and clickable.
  const noData = useMemo(() => {
    if (countries.length === 0) return [];
    const withValue = new Set(data.map((d) => d.iso3));
    return countries
      .filter((c) => !withValue.has(c.iso3))
      .map((c) => ({ iso3: c.iso3, country_name: c.country_name }));
  }, [countries, data]);

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const years = data.map((d) => d.year);
    return {
      min,
      max,
      mean,
      latestYear: Math.max(...years),
    };
  }, [data]);

  return (
    <div className="w-full">
      {/* Metric picker */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {METRICS.map((m) => {
          const Icon = m.icon;
          const active = m.code === metricCode;
          return (
            <button
              key={m.code}
              onClick={() => setMetricCode(m.code)}
              className={cn(
                "group flex flex-col items-start gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-all",
                "hover:border-foreground/20 hover:shadow-sm",
                active
                  ? "border-foreground/30 shadow-sm ring-1 ring-foreground/10"
                  : "border-border"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition-colors",
                  active ? m.accent : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium leading-tight",
                  active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                )}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Map card */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-col gap-1 border-b bg-gradient-to-b from-muted/30 to-transparent px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {metric.label}
            </div>
            <div className="text-base font-semibold text-foreground">
              {metric.fullName}
            </div>
          </div>
          {stats && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <StatChip label="Countries" value={data.length.toString()} />
              <StatChip
                label="Average"
                value={formatNumber(stats.mean, metric.unit)}
              />
              <StatChip
                label="Latest"
                value={stats.latestYear.toString()}
              />
            </div>
          )}
        </div>

        <div className="relative bg-gradient-to-b from-background to-muted/20">
          {isLoading ? (
            <div className="flex h-[520px] items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
                <div className="text-xs text-muted-foreground">
                  Loading world data…
                </div>
              </div>
            </div>
          ) : (
            <ChoroplethMap
              data={data}
              noData={noData}
              unit={metric.unit}
              colorscale={metric.colorscale}
              reverseScale={metric.reverseScale}
              onSelect={(iso3) =>
                router.push(`/country/${iso3}${metric.routeSuffix}`)
              }
            />
          )}
        </div>

        <div className="border-t bg-muted/20 px-5 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {metric.description}{" "}
            <span className="font-medium text-foreground">
              Click any country
            </span>{" "}
            to open its {metric.routeSuffix ? sectionLabel(metric.routeSuffix) : "financing profile"}.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function sectionLabel(suffix: string): string {
  switch (suffix) {
    case "/protection":
      return "financial protection view";
    case "/fiscal":
      return "fiscal space view";
    case "/outcomes":
      return "health outcomes view";
    case "/phc":
      return "primary care view";
    default:
      return "financing profile";
  }
}

function formatNumber(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${unit}`;
}
