import { FileQuestion } from "lucide-react";
import { cn } from "@/lib/utils";

interface NoDataProps {
  /** Short label describing what's missing. Shown in the headline. */
  label?: string;
  /** Optional clarifying sub-text. Falls back to a sensible default. */
  hint?: string;
  /** "panel" = full dashed card (use for whole-section fallbacks).
   *  "chart" = fills a chart slot so axes don't render empty.
   */
  variant?: "panel" | "chart";
  className?: string;
}

const DEFAULT_HINT =
  "This indicator is not reported in the source data used here, or coverage is too sparse to display.";

/**
 * Unified empty-state fallback used across views and chart slots.
 * Prefer this over a silently-blank Plotly canvas.
 */
export function NoData({
  label = "data",
  hint = DEFAULT_HINT,
  variant = "panel",
  className,
}: NoDataProps) {
  if (variant === "chart") {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/10 px-4 py-6 text-center",
          className
        )}
      >
        <FileQuestion
          className="h-5 w-5 text-muted-foreground/60"
          aria-hidden
        />
        <p className="text-xs font-medium text-muted-foreground">
          No {label} available
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground/70">
          {hint}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed bg-muted/20 px-6 py-12 text-center",
        className
      )}
    >
      <FileQuestion
        className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60"
        aria-hidden
      />
      <p className="text-sm font-medium">No {label} reported for this country</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}
