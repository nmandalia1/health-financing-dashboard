"use client";

import { Users } from "lucide-react";

interface BenchmarkToggleProps {
  enabled: boolean;
  onToggle: () => void;
  incomeGroup: string;
  isLoading?: boolean;
}

/**
 * Small pill-shaped toggle that shows / hides income-group peer-band overlays
 * across all charts in a view.
 */
export function BenchmarkToggle({
  enabled,
  onToggle,
  incomeGroup,
  isLoading,
}: BenchmarkToggleProps) {
  return (
    <button
      onClick={onToggle}
      disabled={isLoading}
      title={
        enabled
          ? `Hide ${incomeGroup} peer range bands`
          : `Show the middle 50% range for ${incomeGroup} peers`
      }
      className={[
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        enabled
          ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      ].join(" ")}
    >
      <Users className="h-3 w-3 shrink-0" />
      <span>Peer range</span>
      {enabled && (
        <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
      )}
    </button>
  );
}
