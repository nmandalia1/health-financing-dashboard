"use client";

import { Compass } from "@/components/layout/compass";

import { useEffect, useState, useMemo } from "react";
import {} from "lucide-react";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getPfmLastMileRanking, pfmMartsAvailable } from "@/lib/pfm-queries";
import type { PfmLastMileRow } from "@/lib/pfm-types";
import { INCOME_GROUP_COLORS, INCOME_GROUP_ORDER } from "@/components/charts/chart-config";
import type { Data } from "plotly.js-dist-min";

// ─── score → letter ──────────────────────────────────────────────────────────

function scoreToLetter(score: number): string {
  if (score >= 3.5) return "A";
  if (score >= 2.5) return "B";
  if (score >= 1.5) return "C";
  return "D";
}

function scoreColour(score: number): string {
  if (score >= 3.5) return "#059669"; // emerald
  if (score >= 2.5) return "#2563eb"; // blue
  if (score >= 1.5) return "#d97706"; // amber
  return "#dc2626"; // red
}

// ─── component ───────────────────────────────────────────────────────────────

export function PfmLastMileView() {
  const { conn } = useDuckDB();

  const [rows, setRows] = useState<PfmLastMileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [martsAvailable, setMartsAvailable] = useState<boolean | null>(null);
  const [ssaOnly, setSsaOnly] = useState(false);
  const [scatterY, setScatterY] = useState<"dtp3" | "u5mr" | "malaria">("dtp3");

  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const available = await pfmMartsAvailable(conn);
        if (cancelled) return;
        setMartsAvailable(available);
        if (!available) { setIsLoading(false); return; }
        const data = await getPfmLastMileRanking(conn);
        if (cancelled) return;
        setRows(data);
      } catch (err) {
        console.error("PI-23 last-mile query failed:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conn]);

  const filteredRows = useMemo(
    () => (ssaOnly ? rows.filter((r) => r.is_ssa) : rows),
    [rows, ssaOnly],
  );

  // ─── ranked bar chart ─────────────────────────────────────────────────────

  const barTraces: Data[] = useMemo(() => {
    return INCOME_GROUP_ORDER.map((group) => {
      const pts = filteredRows.filter((r) => r.income_group === group);
      return {
        type: "bar",
        name: group,
        x: pts.map((r) => r.pi23_score),
        y: pts.map((r) => r.country_name),
        orientation: "h",
        marker: { color: INCOME_GROUP_COLORS[group] ?? "#9ca3af" },
        customdata: pts.map((r) => [
          r.pefa_assessment_year,
          scoreToLetter(r.pi23_score),
          r.dtp3_coverage?.toFixed(1) ?? "n/a",
          r.u5mr?.toFixed(1) ?? "n/a",
          r.malaria_incidence?.toFixed(1) ?? "n/a",
        ]),
        hovertemplate:
          "<b>%{y}</b><br>" +
          "PI-23 score: %{x:.2f} (%{customdata[1]})<br>" +
          "PEFA year: %{customdata[0]}<br>" +
          "DTP3 coverage: %{customdata[2]}%<br>" +
          "U5MR: %{customdata[3]}<br>" +
          "Malaria incidence: %{customdata[4]}" +
          "<extra></extra>",
      } as Data;
    }).filter((t) => (t as { x: number[] }).x.length > 0);
  }, [filteredRows]);

  // ─── scatter: PI-23 × selected outcome ────────────────────────────────────

  const scatterTraces: Data[] = useMemo(() => {
    const getY = (r: PfmLastMileRow): number | null =>
      scatterY === "dtp3"
        ? r.dtp3_coverage
        : scatterY === "u5mr"
          ? r.u5mr
          : r.malaria_incidence;

    return INCOME_GROUP_ORDER.map((group) => {
      const pts = filteredRows.filter(
        (r) => r.income_group === group && getY(r) !== null,
      );
      return {
        type: "scatter",
        mode: "markers",
        name: group,
        x: pts.map((r) => r.pi23_score),
        y: pts.map((r) => getY(r)),
        text: pts.map((r) => r.iso3),
        customdata: pts.map((r) => [r.country_name, r.pefa_assessment_year]),
        marker: {
          color: INCOME_GROUP_COLORS[group] ?? "#9ca3af",
          size: 9,
          opacity: 0.8,
          line: { width: 0.5, color: "#fff" },
        },
        hovertemplate:
          "<b>%{customdata[0]}</b> (%{text})<br>" +
          "PI-23: %{x:.2f}<br>" +
          "Outcome: %{y:.1f}<br>" +
          "PEFA year: %{customdata[1]}" +
          "<extra></extra>",
      } as Data;
    }).filter((t) => (t as { x: number[] }).x.length > 0);
  }, [filteredRows, scatterY]);

  const scatterYLabel =
    scatterY === "dtp3"
      ? "DTP3 immunisation coverage (%)"
      : scatterY === "u5mr"
        ? "Under-5 mortality rate (per 1,000)"
        : "Malaria incidence (per 1,000 at-risk)";

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 md:py-10">
        {/* Header */}
        <section>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            PFM &amp; Health · Last-mile focus
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
            Do resources reach service-delivery units? (PEFA PI-23)
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            PEFA PI-23 measures whether budget appropriations actually reach front-line
            health facilities. A = excellent (3.5–4); D = poor (&lt;1.5). Countries are
            ranked by their latest PI-23 score.
          </p>
        </section>

        {/* Filter */}
        <section className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={ssaOnly}
              onChange={(e) => setSsaOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            Sub-Saharan Africa only
          </label>
          <span className="text-xs text-muted-foreground">
            {filteredRows.length} countries
          </span>
        </section>

        {/* Ranked bar chart */}
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-1 text-sm font-medium">Countries ranked by PI-23 score</h2>
          <p className="mb-3 text-[11px] text-muted-foreground">
            Latest PEFA assessment per country. Colour = income group.
          </p>
          <div style={{ height: Math.max(400, filteredRows.length * 18) }}>
            {martsAvailable === null || isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
              </div>
            ) : martsAvailable === false ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-muted-foreground">PFM data not available.</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Run <code className="rounded bg-muted px-1 py-0.5">python run_pipeline.py</code> to
                  ingest PEFA assessments.
                </p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">No data for this filter.</p>
              </div>
            ) : (
              <PlotlyChart
                className="h-full"
                data={barTraces}
                layout={{
                  barmode: "stack",
                  xaxis: {
                    title: { text: "PI-23 score (0–4)" },
                    range: [0, 4.2],
                  },
                  yaxis: {
                    automargin: true,
                    tickfont: { size: 10 },
                  },
                  margin: { l: 140, r: 24, t: 24, b: 40 },
                  legend: {
                    orientation: "h",
                    yanchor: "bottom",
                    y: 1.02,
                    xanchor: "left",
                    x: 0,
                  },
                  // Grade reference lines
                  shapes: [
                    { type: "line", x0: 1.5, x1: 1.5, y0: 0, y1: 1, yref: "paper", xref: "x", line: { color: "#9ca3af", width: 1, dash: "dot" } },
                    { type: "line", x0: 2.5, x1: 2.5, y0: 0, y1: 1, yref: "paper", xref: "x", line: { color: "#9ca3af", width: 1, dash: "dot" } },
                    { type: "line", x0: 3.5, x1: 3.5, y0: 0, y1: 1, yref: "paper", xref: "x", line: { color: "#9ca3af", width: 1, dash: "dot" } },
                  ],
                  annotations: [
                    { x: 0.75, xref: "x", y: 1, yref: "paper", text: "D", showarrow: false, font: { size: 11, color: "#9ca3af" }, yanchor: "bottom" },
                    { x: 2, xref: "x", y: 1, yref: "paper", text: "C", showarrow: false, font: { size: 11, color: "#9ca3af" }, yanchor: "bottom" },
                    { x: 3, xref: "x", y: 1, yref: "paper", text: "B", showarrow: false, font: { size: 11, color: "#9ca3af" }, yanchor: "bottom" },
                    { x: 3.75, xref: "x", y: 1, yref: "paper", text: "A", showarrow: false, font: { size: 11, color: "#9ca3af" }, yanchor: "bottom" },
                  ],
                }}
              />
            )}
          </div>
        </section>

        {/* Scatter: PI-23 × outcome */}
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">PI-23 score vs health outcome</h2>
              <p className="text-[11px] text-muted-foreground">
                Do countries with better last-mile budget execution achieve better outcomes?
              </p>
            </div>
            <div className="flex gap-1.5">
              {(
                [
                  ["dtp3", "DTP3 coverage"],
                  ["u5mr", "U5MR"],
                  ["malaria", "Malaria"],
                ] as ["dtp3" | "u5mr" | "malaria", string][]
              ).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setScatterY(code)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    scatterY === code
                      ? "border-foreground/30 bg-accent text-accent-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[420px]">
            {!isLoading && filteredRows.length > 0 && (
              <PlotlyChart
                className="h-full"
                data={scatterTraces}
                layout={{
                  xaxis: {
                    title: { text: "PI-23 score (0–4)" },
                    range: [0, 4.2],
                  },
                  yaxis: {
                    title: { text: scatterYLabel },
                  },
                  legend: {
                    orientation: "h",
                    yanchor: "bottom",
                    y: 1.02,
                    xanchor: "left",
                    x: 0,
                  },
                }}
              />
            )}
            {isLoading && (
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
              </div>
            )}
            {!isLoading && filteredRows.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">No data available.</p>
              </div>
            )}
          </div>
        </section>

        {/* Score legend */}
        <section className="flex flex-wrap gap-3">
          {(
            [
              ["A", "≥ 3.5", "#059669"],
              ["B", "2.5–3.49", "#2563eb"],
              ["C", "1.5–2.49", "#d97706"],
              ["D", "< 1.5", "#dc2626"],
            ] as [string, string, string][]
          ).map(([grade, range, colour]) => (
            <div
              key={grade}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs"
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-sm font-bold text-white"
                style={{ backgroundColor: colour }}
              >
                {grade}
              </span>
              <span className="text-muted-foreground">{range}</span>
            </div>
          ))}
        </section>
        <Compass />
      </div>
  );
}
