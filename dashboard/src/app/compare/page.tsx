"use client";

import { Suspense } from "react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Plus, X, Link2, Users } from "lucide-react";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { useCountries } from "@/hooks/use-countries";
import { useDuckDB } from "@/lib/duckdb-provider";
import {
  getMultiCountryIndicator,
  getIncomeGroupAverage,
} from "@/lib/queries";
import {
  COMPARE_INDICATOR_GROUPS,
  findCompareIndicator,
  type CompareIndicator,
} from "@/lib/compare-indicators";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { YearRangePicker } from "@/components/ui/year-range-picker";
import { useYearRange } from "@/lib/year-range-context";
import { INCOME_GROUP_COLORS, INCOME_GROUP_ORDER } from "@/components/charts/chart-config";
import type { Data } from "plotly.js-dist-min";

const COUNTRY_PALETTE = [
  "#2563eb", // blue
  "#d97706", // amber
  "#0d9488", // teal
  "#dc2626", // red
  "#7c3aed", // violet
];

const MAX_COUNTRIES = 5;

type SelectionMode = "countries" | "income-group";
type GroupDisplay = "average" | "all";

export default function ComparePageShell() {
  return (
    <Suspense>
      <ComparePage />
    </Suspense>
  );
}

function ComparePage() {
  const { conn } = useDuckDB();
  const { countries } = useCountries();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);
  const { startYear, endYear } = useYearRange();

  // Seed from URL
  const urlCountries = (searchParams.get("countries") || "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_COUNTRIES);
  const urlIndicator = searchParams.get("indicator") || "";

  const [mode, setMode] = useState<SelectionMode>("countries");
  const [selected, setSelected] = useState<string[]>(urlCountries);
  const [selectedGroup, setSelectedGroup] = useState<string>(INCOME_GROUP_ORDER[0]);
  const [groupDisplay, setGroupDisplay] = useState<GroupDisplay>("average");
  const [indicatorCode, setIndicatorCode] = useState<string>(
    findCompareIndicator(urlIndicator)
      ? urlIndicator
      : COMPARE_INDICATOR_GROUPS[0].items[0].code
  );
  const [rows, setRows] = useState<Array<{ iso3: string; year: number; value: number }>>([]);
  const [groupRows, setGroupRows] = useState<Array<{ year: number; value: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const indicator = useMemo(
    () =>
      findCompareIndicator(indicatorCode) ??
      COMPARE_INDICATOR_GROUPS[0].items[0],
    [indicatorCode]
  );

  // Default countries on first load
  useEffect(() => {
    if (selected.length === 0 && countries.length > 0 && urlCountries.length === 0) {
      const defaults = ["KEN", "RWA", "GHA", "USA"].filter((c) =>
        countries.some((x) => x.iso3 === c)
      );
      setSelected(defaults.slice(0, MAX_COUNTRIES));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries, selected.length]);

  // Sync URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (mode === "countries" && selected.length > 0) {
      params.set("countries", selected.join(","));
    }
    if (indicatorCode !== COMPARE_INDICATOR_GROUPS[0].items[0].code) {
      params.set("indicator", indicatorCode);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, indicatorCode, mode]);

  // Fetch country data
  useEffect(() => {
    if (mode !== "countries" || !conn || selected.length === 0) {
      setRows([]);
      return;
    }
    setIsLoading(true);
    getMultiCountryIndicator(conn, selected, indicatorCode)
      .then(setRows)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [conn, selected, indicatorCode, mode]);

  // Fetch income group data
  useEffect(() => {
    if (mode !== "income-group" || !conn) {
      setGroupRows([]);
      return;
    }
    setIsLoading(true);
    getIncomeGroupAverage(conn, selectedGroup, indicatorCode)
      .then(setGroupRows)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [conn, selectedGroup, indicatorCode, mode]);

  const countryByIso = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of countries) map.set(c.iso3, c.country_name);
    return map;
  }, [countries]);

  // Countries in selected income group (for "all countries" mode)
  const countriesInGroup = useMemo(
    () => countries.filter((c) => c.wb_income_group === selectedGroup),
    [countries, selectedGroup]
  );

  const [allGroupRows, setAllGroupRows] = useState<
    Array<{ iso3: string; year: number; value: number }>
  >([]);

  useEffect(() => {
    if (mode !== "income-group" || groupDisplay !== "all" || !conn) {
      setAllGroupRows([]);
      return;
    }
    setIsLoading(true);
    const iso3s = countriesInGroup.map((c) => c.iso3);
    getMultiCountryIndicator(conn, iso3s, indicatorCode)
      .then(setAllGroupRows)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [conn, countriesInGroup, indicatorCode, mode, groupDisplay]);

  const traces: Data[] = useMemo(() => {
    const filterYear = (pts: { year: number; value: number }[]) =>
      pts.filter((d) => d.year >= startYear && d.year <= endYear);

    if (mode === "income-group") {
      if (groupDisplay === "average") {
        const pts = filterYear(groupRows);
        return [
          {
            type: "scatter",
            mode: "lines",
            x: pts.map((d) => d.year),
            y: pts.map((d) => d.value),
            name: `${selectedGroup} — average`,
            line: {
              color: INCOME_GROUP_COLORS[selectedGroup] || "#6b7280",
              width: 2.5,
            },
            hovertemplate: `%{x}: ${indicator.hoverValue}<extra>${selectedGroup} avg</extra>`,
          } as Data,
        ];
      }
      // All countries in group
      const grouped = new Map<string, Array<{ year: number; value: number }>>();
      for (const r of allGroupRows) {
        if (!grouped.has(r.iso3)) grouped.set(r.iso3, []);
        grouped.get(r.iso3)!.push({ year: r.year, value: r.value });
      }
      return countriesInGroup.map((c, i) => {
        const pts = filterYear(grouped.get(c.iso3) ?? []);
        return {
          type: "scatter",
          mode: "lines",
          x: pts.map((d) => d.year),
          y: pts.map((d) => d.value),
          name: c.country_name,
          line: {
            color: INCOME_GROUP_COLORS[selectedGroup] || "#6b7280",
            width: 1.5,
            opacity: 0.6,
          },
          hovertemplate: `%{x}: ${indicator.hoverValue}<extra>${c.country_name}</extra>`,
        } as Data;
      });
    }

    // Individual countries mode
    const groupedRows = new Map<string, Array<{ year: number; value: number }>>();
    for (const r of rows) {
      if (!groupedRows.has(r.iso3)) groupedRows.set(r.iso3, []);
      groupedRows.get(r.iso3)!.push({ year: r.year, value: r.value });
    }
    return selected.map((iso3, i) => {
      const pts = filterYear(groupedRows.get(iso3) ?? []);
      return {
        type: "scatter",
        mode: "lines",
        x: pts.map((d) => d.year),
        y: pts.map((d) => d.value),
        name: countryByIso.get(iso3) ?? iso3,
        line: { color: COUNTRY_PALETTE[i % COUNTRY_PALETTE.length], width: 2 },
        hovertemplate: `%{x}: ${indicator.hoverValue}<extra>${
          countryByIso.get(iso3) ?? iso3
        }</extra>`,
      } as Data;
    });
  }, [
    rows,
    groupRows,
    allGroupRows,
    selected,
    countryByIso,
    indicator,
    mode,
    selectedGroup,
    groupDisplay,
    countriesInGroup,
    startYear,
    endYear,
  ]);

  const filteredCountries = useMemo(() => {
    const s = search.toLowerCase();
    return countries
      .filter((c) => !selected.includes(c.iso3))
      .filter(
        (c) =>
          !s ||
          c.country_name.toLowerCase().includes(s) ||
          c.iso3.toLowerCase().includes(s)
      )
      .slice(0, 80);
  }, [countries, search, selected]);

  const addCountry = (iso3: string) => {
    if (selected.length >= MAX_COUNTRIES) return;
    setSelected((prev) => [...prev, iso3]);
    setSearch("");
    setPickerOpen(false);
  };
  const removeCountry = (iso3: string) => {
    setSelected((prev) => prev.filter((c) => c !== iso3));
  };

  const benchmarkShape = indicator.benchmark
    ? [
        {
          type: "line" as const,
          x0: 0,
          x1: 1,
          xref: "paper" as const,
          y0: indicator.benchmark.value,
          y1: indicator.benchmark.value,
          yref: "y" as const,
          line: { color: "#9ca3af", width: 1.5, dash: "dash" as const },
        },
      ]
    : [];
  const benchmarkAnnotation = indicator.benchmark
    ? [
        {
          x: 1,
          xref: "paper" as const,
          y: indicator.benchmark.value,
          yref: "y" as const,
          text: indicator.benchmark.label,
          showarrow: false,
          xanchor: "right" as const,
          yanchor: "bottom" as const,
          font: { size: 11, color: "#6b7280" },
        },
      ]
    : [];

  const subtitle =
    mode === "income-group"
      ? groupDisplay === "average"
        ? `${selectedGroup} — group average · ${startYear}–${endYear}`
        : `${selectedGroup} — all ${countriesInGroup.length} countries · ${startYear}–${endYear}`
      : `${selected.length} countries · ${startYear}–${endYear}`;

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8 md:py-12">
        {/* Page header */}
        <section className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Compare
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Cross-Country Comparison
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare countries or income groups on a single indicator over time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <YearRangePicker />
            <button
              type="button"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  /* ignore */
                }
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-foreground/20 hover:text-foreground"
            >
              <Link2 className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </section>

        {/* Mode toggle */}
        <section>
          <div className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setMode("countries")}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "countries"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Individual countries
            </button>
            <button
              type="button"
              onClick={() => setMode("income-group")}
              className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "income-group"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              By income group
            </button>
          </div>
        </section>

        {/* Country picker (mode = countries) */}
        {mode === "countries" && (
          <section className="flex flex-wrap items-center gap-2">
            {selected.map((iso3, i) => (
              <span
                key={iso3}
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm font-medium"
                style={{ borderColor: COUNTRY_PALETTE[i % COUNTRY_PALETTE.length] + "66" }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: COUNTRY_PALETTE[i % COUNTRY_PALETTE.length] }}
                />
                {countryByIso.get(iso3) ?? iso3}
                <button
                  type="button"
                  onClick={() => removeCountry(iso3)}
                  aria-label={`Remove ${iso3}`}
                  className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {selected.length < MAX_COUNTRIES && (
              <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
                <DialogTrigger className="inline-flex items-center gap-1.5 rounded-full border border-dashed bg-transparent px-3 py-1 text-sm font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground">
                  <Plus className="h-3.5 w-3.5" />
                  Add country
                </DialogTrigger>
                <DialogContent className="p-0 sm:max-w-md">
                  <DialogTitle className="px-4 pt-4 text-sm font-semibold">
                    Add a country
                  </DialogTitle>
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search by name or ISO3…"
                      value={search}
                      onValueChange={setSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No countries found.</CommandEmpty>
                      <CommandGroup>
                        {filteredCountries.map((c) => (
                          <CommandItem
                            key={c.iso3}
                            value={c.iso3}
                            onSelect={() => addCountry(c.iso3)}
                            className="flex items-center justify-between"
                          >
                            <span>{c.country_name}</span>
                            <span className="text-xs text-muted-foreground">
                              {c.wb_income_group ?? c.iso3}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </DialogContent>
              </Dialog>
            )}
          </section>
        )}

        {/* Income group picker (mode = income-group) */}
        {mode === "income-group" && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Income group
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {INCOME_GROUP_ORDER.filter((g) => g !== "Not classified").map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setSelectedGroup(g)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        selectedGroup === g
                          ? "border-transparent text-white"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      }`}
                      style={
                        selectedGroup === g
                          ? { backgroundColor: INCOME_GROUP_COLORS[g] }
                          : undefined
                      }
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ml-auto">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Display
                </p>
                <div className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5">
                  <button
                    type="button"
                    onClick={() => setGroupDisplay("average")}
                    className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                      groupDisplay === "average"
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Group average
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroupDisplay("all")}
                    className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                      groupDisplay === "all"
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All countries ({countriesInGroup.length})
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Indicator selector */}
        <section className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Indicator
          </p>
          <div className="space-y-3">
            {COMPARE_INDICATOR_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map((item) => (
                    <IndicatorChip
                      key={item.code}
                      item={item}
                      active={item.code === indicatorCode}
                      onSelect={() => setIndicatorCode(item.code)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Chart */}
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">
                {indicator.label}
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                {subtitle}
              </p>
            </div>
          </div>
          <div className="h-[420px]">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
              </div>
            ) : traces.length === 0 || traces.every((t) => (t as {x: unknown[]}).x.length === 0) ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  No data for this combination.
                </p>
              </div>
            ) : (
              <PlotlyChart
                className="h-full"
                data={traces}
                layout={{
                  hovermode: "x unified" as const,
                  shapes: benchmarkShape,
                  annotations: benchmarkAnnotation,
                  yaxis: { title: { text: indicator.label } },
                  xaxis: { dtick: 2, range: [startYear, endYear] },
                }}
              />
            )}
          </div>
        </section>
      </div>
  );
}

function IndicatorChip({
  item,
  active,
  onSelect,
}: {
  item: CompareIndicator;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-foreground/30 bg-accent text-accent-foreground ring-1 ring-foreground/10"
          : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      }`}
    >
      {item.label}
    </button>
  );
}
