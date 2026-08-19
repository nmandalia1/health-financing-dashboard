"use client";

import { useCountryName } from "@/hooks/use-country-name";


import { useEffect, useState } from "react";
import {} from "lucide-react";
import { PlotlyChart } from "@/components/charts/plotly-chart";
import { useDuckDB } from "@/lib/duckdb-provider";
import {
  getPfmTimelineForCountry,
  getPfmEventsForCountry,
  pfmMartsAvailable,
} from "@/lib/pfm-queries";
import type { PfmHealthRow, PfmEventRow } from "@/lib/pfm-types";
import type { Data, Shape, Annotations } from "plotly.js-dist-min";

// ─── helpers ────────────────────────────────────────────────────────────────

function scoreLabel(score: number | null): string {
  if (score === null) return "—";
  return score.toFixed(2);
}

/** Build a coloured band shape for an assessment window. */
function assessmentBand(
  yearStart: number,
  yearEnd: number,
  color = "rgba(37,99,235,0.08)",
): Partial<Shape> {
  return {
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: yearStart,
    x1: yearEnd,
    y0: 0,
    y1: 1,
    fillcolor: color,
    line: { width: 0 },
    layer: "below",
  };
}

// ─── component ───────────────────────────────────────────────────────────────

interface PfmCountryViewProps {
  iso3: string;
}

export function PfmCountryView({ iso3 }: PfmCountryViewProps) {
  const { conn } = useDuckDB();

  const [timeline, setTimeline] = useState<PfmHealthRow[]>([]);
  const [events, setEvents] = useState<PfmEventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [martsAvailable, setMartsAvailable] = useState<boolean | null>(null);

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
        const [tl, ev] = await Promise.all([
          getPfmTimelineForCountry(conn, iso3),
          getPfmEventsForCountry(conn, iso3),
        ]);
        if (cancelled) return;
        setTimeline(tl);
        setEvents(ev);
      } catch (err) {
        console.error("PFM country query failed:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conn, iso3]);

  // Derived values for the header
  const countryName = useCountryName(iso3);

  const latestRow = [...timeline].sort((a, b) => b.year - a.year).find(
    (r) => r.pefa_pillar3_pcbe !== null || r.pefa11_pcbe !== null,
  );

  // ─── build traces ─────────────────────────────────────────────────────────

  const years = timeline.map((r) => r.year);

  // PEFA scores — show coalesced PCBE pillar
  const pcbeValues = timeline.map((r) =>
    r.pefa_pillar3_pcbe ?? r.pefa11_pcbe ?? null,
  );
  const overallValues = timeline.map((r) =>
    r.pefa_overall ?? r.pefa11_overall ?? null,
  );

  // U5MR
  const u5mrValues = timeline.map((r) => r.u5mr);
  // MMR
  const mmrValues = timeline.map((r) => r.mmr);
  // GGHE-D/CHE financing share
  const ggheCheValues = timeline.map((r) => r.gghed_pct_che);

  // Assessment event vertical markers
  const eventShapes: Partial<Shape>[] = events.map((ev) => ({
    type: "line",
    xref: "x",
    yref: "paper",
    x0: ev.assessment_year,
    x1: ev.assessment_year,
    y0: 0,
    y1: 1,
    line: { color: "#2563eb", width: 1.5, dash: "dot" },
  }));

  const eventAnnotations: Partial<Annotations>[] = events.map((ev) => ({
    x: ev.assessment_year,
    xref: "x",
    y: 1,
    yref: "paper",
    yanchor: "top",
    text: `PEFA ${ev.assessment_year}`,
    showarrow: false,
    font: { size: 9, color: "#2563eb" },
    textangle: "-90",
  }));

  // Piatti 75% threshold line on GGHE-D/CHE axis (subplot 3)
  const piattiShape: Partial<Shape> = {
    type: "line",
    xref: "paper",
    yref: "y3",
    x0: 0,
    x1: 1,
    y0: 75,
    y1: 75,
    line: { color: "#d97706", width: 1.5, dash: "dash" },
  };
  const piattiAnnotation: Partial<Annotations> = {
    x: 1,
    xref: "paper",
    y: 75,
    yref: "y3",
    text: "75% threshold (Piatti)",
    showarrow: false,
    xanchor: "right",
    yanchor: "bottom",
    font: { size: 10, color: "#d97706" },
  };

  const traces: Data[] = [
    // Subplot 1: PCBE pillar
    {
      type: "scatter",
      mode: "lines+markers",
      name: "PCBE pillar score",
      x: years,
      y: pcbeValues,
      yaxis: "y",
      line: { color: "#2563eb", width: 2 },
      marker: { size: 4 },
      connectgaps: false,
      hovertemplate: "%{x}: %{y:.2f}<extra>PCBE pillar</extra>",
    } as Data,
    {
      type: "scatter",
      mode: "lines",
      name: "Overall PEFA",
      x: years,
      y: overallValues,
      yaxis: "y",
      line: { color: "#2563eb", width: 1, dash: "dot" },
      connectgaps: false,
      hovertemplate: "%{x}: %{y:.2f}<extra>Overall PEFA</extra>",
    } as Data,
    // Subplot 2: U5MR + MMR (shared y2 — different scales, use secondary axes)
    {
      type: "scatter",
      mode: "lines+markers",
      name: "U5MR (per 1,000)",
      x: years,
      y: u5mrValues,
      yaxis: "y2",
      line: { color: "#dc2626", width: 2 },
      marker: { size: 4 },
      connectgaps: true,
      hovertemplate: "%{x}: %{y:.1f}<extra>U5MR</extra>",
    } as Data,
    // Subplot 3: GGHE-D / CHE
    {
      type: "scatter",
      mode: "lines+markers",
      name: "GGHE-D / CHE (%)",
      x: years,
      y: ggheCheValues,
      yaxis: "y3",
      line: { color: "#d97706", width: 2 },
      marker: { size: 4 },
      connectgaps: true,
      hovertemplate: "%{x}: %{y:.1f}%<extra>GGHE-D/CHE</extra>",
    } as Data,
  ];

  const layout: Partial<import("plotly.js-dist-min").Layout> = {
    grid: { rows: 3, columns: 1, pattern: "independent", roworder: "top to bottom" },
    height: 680,
    yaxis: {
      title: { text: "PEFA score (0–4)" },
      range: [0, 4.2],
      domain: [0.68, 1],
    },
    yaxis2: {
      title: { text: "U5MR (per 1,000)" },
      domain: [0.36, 0.64],
    },
    yaxis3: {
      title: { text: "GGHE-D / CHE (%)" },
      domain: [0, 0.32],
      range: [0, 105],
    },
    xaxis: { title: { text: "" } },
    shapes: [...eventShapes, piattiShape],
    annotations: [...eventAnnotations, piattiAnnotation],
    margin: { l: 64, r: 24, t: 32, b: 40 },
    showlegend: true,
    legend: {
      orientation: "h",
      yanchor: "bottom",
      y: 1.02,
      xanchor: "left",
      x: 0,
    },
  };

  // ─── Scorecard summary row ─────────────────────────────────────────────────
  const latestPcbe =
    latestRow?.pefa_pillar3_pcbe ?? latestRow?.pefa11_pcbe ?? null;
  const latestOverall =
    latestRow?.pefa_overall ?? latestRow?.pefa11_overall ?? null;
  const latestFinancing = latestRow?.gghed_pct_che ?? null;
  const latestGov = latestRow?.wgi_govt_effectiveness ?? null;
  const latestU5mr = latestRow?.u5mr ?? null;

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
        {/* Header */}
        <section>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            PFM &amp; Health · Country view
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
            {countryName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Shows PEFA budget-management scores alongside health outcomes and the public
            share of health spending. Vertical dotted lines mark PEFA assessment years;
            the horizontal dashed line marks Piatti's 75% public-financing threshold.
          </p>
        </section>

        {/* Scorecard */}
        {!isLoading && latestRow && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              {
                label: "PCBE pillar",
                value: scoreLabel(latestPcbe),
                sub: `PEFA ${latestRow.pefa_assessment_year ?? latestRow.year}`,
              },
              {
                label: "Overall PEFA",
                value: scoreLabel(latestOverall),
                sub: latestRow.pefa_framework ?? "—",
              },
              {
                label: "U5MR",
                value: latestU5mr !== null ? latestU5mr.toFixed(1) : "—",
                sub: "per 1,000",
              },
              {
                label: "GGHE-D/CHE",
                value: latestFinancing !== null ? `${latestFinancing.toFixed(1)}%` : "—",
                sub: latestFinancing !== null && latestFinancing >= 75
                  ? "≥75% (Piatti threshold)"
                  : latestFinancing !== null && latestFinancing >= 50
                    ? "50–75%"
                    : "< 50%",
              },
              {
                label: "Government effectiveness",
                value: latestGov !== null ? latestGov.toFixed(2) : "—",
                sub: "−2.5 to +2.5",
              },
            ].map(({ label, value, sub }) => (
              <div
                key={label}
                className="rounded-lg border bg-card px-4 py-3 text-center"
              >
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
              </div>
            ))}
          </section>
        )}

        {/* Chart */}
        <section className="rounded-lg border bg-card p-4">
          {martsAvailable === null || isLoading ? (
            <div className="flex h-[680px] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
            </div>
          ) : martsAvailable === false ? (
            <div className="flex h-[680px] flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">PFM data not available.</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Run the pipeline to ingest PEFA assessments first.
              </p>
            </div>
          ) : timeline.length === 0 ? (
            <div className="flex h-[680px] items-center justify-center">
              <p className="text-sm text-muted-foreground">
                No PFM data found for {iso3}.
              </p>
            </div>
          ) : (
            <PlotlyChart
              className="h-[680px]"
              data={traces}
              layout={layout}
            />
          )}
        </section>

        {/* PEFA events table */}
        {events.length > 0 && (
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium">PEFA assessments</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-4">Year</th>
                    <th className="pb-2 pr-4">Overall</th>
                    <th className="pb-2 pr-4">PCBE pillar</th>
                    <th className="pb-2 pr-4">Budget reliab.</th>
                    <th className="pb-2 pr-4">PI-23</th>
                    <th className="pb-2 pr-4">GGHE-D/CHE</th>
                    <th className="pb-2">WGI GE</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.assessment_year} className="border-b last:border-0">
                      <td className="py-1.5 pr-4 font-medium">{ev.assessment_year}</td>
                      <td className="py-1.5 pr-4">
                        {ev.pefa_overall?.toFixed(2) ??
                          ev.pefa11_overall?.toFixed(2) ??
                          "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {ev.pefa_pillar3_pcbe?.toFixed(2) ??
                          ev.pefa11_pcbe?.toFixed(2) ??
                          "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {ev.pefa_budget_reliab?.toFixed(2) ??
                          ev.pefa11_budget_reliab?.toFixed(2) ??
                          "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {ev.pefa_pi23_lastmile?.toFixed(2) ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {ev.gghed_pct_che !== null
                          ? `${ev.gghed_pct_che.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="py-1.5">
                        {ev.wgi_govt_effectiveness?.toFixed(2) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
  );
}
