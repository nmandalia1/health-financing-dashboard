"use client";

import { useEffect, useRef, useState } from "react";
import { Info, X } from "lucide-react";

export interface InfoTooltipData {
  /** Name of the indicator / chart (bold header in the popover) */
  title: string;
  /** What the data represents — 1–2 sentences */
  description: string;
  /** Short source label, e.g. "WHO Global Health Expenditure Database (GHED)" */
  source: string;
  /** Year range of available data, e.g. "2000–2023 (24 obs)" */
  yearRange?: string;
  /** What the value suggests about the country — analytical framing */
  interpretation?: string;
  /** Optional reference URL */
  referenceUrl?: string;
}

interface InfoTooltipProps extends InfoTooltipData {
  className?: string;
  /** Button size. Default: "sm" */
  size?: "xs" | "sm";
  /**
   * Tooltip alignment relative to the button.
   * "right" (default) opens to the left; "left" opens to the right.
   */
  align?: "left" | "right";
}

/**
 * Small "i" icon that toggles a popover describing a chart or KPI:
 * what the metric is, its source, year coverage, and analytical framing.
 */
export function InfoTooltip({
  title,
  description,
  source,
  yearRange,
  interpretation,
  referenceUrl,
  className,
  size = "sm",
  align = "right",
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const iconSize = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  const alignClass = align === "right" ? "right-0" : "left-0";

  return (
    <span
      ref={containerRef}
      className={`relative inline-flex shrink-0 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`About ${title}`}
        aria-expanded={open}
        className={`inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          open ? "bg-muted text-foreground" : ""
        }`}
      >
        <Info className={iconSize} />
      </button>

      {open && (
        <div
          role="tooltip"
          className={`absolute top-full ${alignClass} z-50 mt-1 w-72 rounded-lg border bg-popover p-3 text-xs shadow-lg`}
          // Stop propagation so clicks inside don't dismiss
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <h3 className="text-[13px] font-semibold leading-tight text-foreground">
              {title}
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="shrink-0 rounded text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          <p className="leading-relaxed text-muted-foreground">{description}</p>

          {interpretation && (
            <div className="mt-2 rounded-md border-l-2 border-blue-400 bg-blue-50/50 py-1.5 pl-2 pr-2 text-[11px] leading-relaxed text-foreground/80">
              <span className="font-medium text-blue-700">
                How to read it:{" "}
              </span>
              {interpretation}
            </div>
          )}

          <dl className="mt-2 space-y-0.5 border-t pt-2 text-[11px] text-muted-foreground/90">
            <div className="flex gap-1.5">
              <dt className="shrink-0 font-medium">Source:</dt>
              <dd>{source}</dd>
            </div>
            {yearRange && (
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-medium">Years:</dt>
                <dd className="tabular-nums">{yearRange}</dd>
              </div>
            )}
            {referenceUrl && (
              <a
                href={referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block text-blue-600 hover:underline"
              >
                Source details
              </a>
            )}
          </dl>
        </div>
      )}
    </span>
  );
}
