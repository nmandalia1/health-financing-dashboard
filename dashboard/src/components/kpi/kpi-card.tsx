import { cn } from "@/lib/utils";
import { InfoTooltip, type InfoTooltipData } from "@/components/ui/info-tooltip";
import { KpiTrace } from "./kpi-trace";
import { KPI_CELL } from "./kpi-cell";
import type { IndicatorTimeSeries } from "@/lib/types";

/**
 * One column of the KPI ledger: name, figure, change, trace, period.
 *
 * Five stacked rows, each set differently — mono caps, a large figure, a mono
 * delta, a graphic, hairline years — so nothing competes for the same reading.
 * The card chrome is gone: four bordered boxes in a row read as four competing
 * frames, where one ruled band with hairline rules reads as a single object
 * holding four figures.
 *
 * Rows come from KpiRow via `subgrid`, so every column's figure sits on the same
 * line regardless of how far its label wraps.
 */

interface KpiCardProps {
  label: string;
  value: number | null;
  unit?: string;
  previousValue?: number;
  /** Year the latest value refers to */
  year?: number;
  /** Year the previous value refers to (for trend context) */
  previousYear?: number;
  /** Short data source label e.g. "WHO GHED" — surfaced via the ⓘ popover */
  source?: string;
  colorClass?: string;
  /** Optional rich info popover (indicator description, interpretation, reference) */
  info?: InfoTooltipData;
  /** History behind the figure. Omit and the cell keeps the first three rows. */
  series?: IndicatorTimeSeries[];
  /**
   * Which way is good. Without it the change is reported but not judged —
   * colouring every rise green is wrong for half these indicators (a rising
   * out-of-pocket share is bad news), so an unstated direction stays neutral.
   */
  direction?: "higher-better" | "lower-better";
}

export function KpiCard({
  label,
  value,
  unit = "",
  previousValue,
  year,
  previousYear,
  source,
  colorClass,
  info,
  series,
  direction,
}: KpiCardProps) {
  // The unit is set a size down and lighter, so the digits carry the figure.
  let prefix = "";
  let digits = "—";
  let suffix = "";
  if (value !== null) {
    if (unit === "%") {
      digits = value.toFixed(1);
      suffix = "%";
    } else if (unit === "$") {
      prefix = "$";
      digits = value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    } else {
      digits = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }
  }

  let trend: "up" | "down" | "flat" | null = null;
  let pctChange: number | null = null;
  if (value !== null && previousValue !== undefined && previousValue !== 0) {
    pctChange = ((value - previousValue) / Math.abs(previousValue)) * 100;
    if (Math.abs(pctChange) < 0.5) trend = "flat";
    else trend = pctChange > 0 ? "up" : "down";
  }

  const trace = series?.filter((d) => d.value !== null) ?? [];
  const hasTrace = trace.length >= 2;

  const tooltipParts: string[] = [];
  if (year !== undefined) tooltipParts.push(`Latest year: ${year}`);
  if (previousYear !== undefined && previousValue !== undefined) {
    tooltipParts.push(
      `Previous: ${previousValue.toFixed(1)}${unit === "%" ? "%" : ""} (${previousYear})`
    );
  }
  if (source) tooltipParts.push(`Source: ${source}`);
  const tooltip = tooltipParts.join(" • ");

  return (
    <div className={KPI_CELL} title={tooltip || undefined}>
      {/* 1 — name */}
      <div className="flex min-h-[30px] items-start gap-1 self-start">
        <p className="font-mono text-[10px] uppercase leading-[1.5] tracking-[0.09em] text-muted-foreground">
          {label}
        </p>
        {info && <InfoTooltip {...info} size="xs" align="left" />}
      </div>

      {/* 2 — figure */}
      <p
        className={cn(
          "self-end pt-3 text-[34px] font-medium leading-none tabular-nums tracking-[-0.03em]",
          colorClass
        )}
      >
        {prefix && <span className="text-[19px] opacity-50">{prefix}</span>}
        {digits}
        {suffix && <span className="text-[19px] opacity-50">{suffix}</span>}
      </p>

      {/* 3 — change. Keeps its own period: the delta is year-on-year, while the
             trace below spans the whole history, and they rarely match. */}
      <p className="self-end pt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
        {trend && pctChange !== null ? (
          <>
            <b
              className={cn(
                "font-semibold",
                direction === undefined || trend === "flat"
                  ? "text-foreground/80"
                  : (trend === "up") === (direction === "higher-better")
                    ? "text-emerald-500"
                    : "text-red-400"
              )}
            >
              {pctChange > 0 ? "+" : "−"}
              {Math.abs(pctChange).toFixed(1)}%
            </b>
            {previousYear !== undefined && (
              <span className="ml-1.5">since {previousYear}</span>
            )}
          </>
        ) : null}
      </p>

      {/* 4 & 5 — trace and the period it covers. Omitted entirely rather than
             left empty: a cell places its children into consecutive subgrid
             rows, so a three-row cell still aligns with a five-row neighbour,
             and a band where nothing has a series collapses to three rows
             instead of carrying dead space. */}
      {hasTrace && (
        <div
          className={cn(
            "self-end pt-3.5",
            colorClass ?? "text-muted-foreground/80"
          )}
        >
          <KpiTrace
            data={trace}
            label={`${label}: ${trace[0].year} to ${trace[trace.length - 1].year}`}
          />
        </div>
      )}
      {hasTrace && (
        <div className="flex justify-between self-end pt-1.5 font-mono text-[9.5px] tabular-nums tracking-[0.06em] text-muted-foreground/65">
          <span>{trace[0].year}</span>
          <span>{trace[trace.length - 1].year}</span>
        </div>
      )}
    </div>
  );
}
