"use client";

import { useYearRange } from "@/lib/year-range-context";

const MIN_YEAR = 2000;
const MAX_YEAR = 2024;

export function YearRangePicker() {
  const { startYear, endYear, setStartYear, setEndYear } = useYearRange();

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium">Period:</span>
      <select
        value={startYear}
        onChange={(e) => {
          const v = Number(e.target.value);
          setStartYear(v);
          if (v > endYear) setEndYear(v);
        }}
        className="rounded border bg-background px-1.5 py-0.5 text-xs text-foreground"
        aria-label="Start year"
      >
        {Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map(
          (y) => (
            <option key={y} value={y} disabled={y > endYear}>
              {y}
            </option>
          )
        )}
      </select>
      <span>–</span>
      <select
        value={endYear}
        onChange={(e) => {
          const v = Number(e.target.value);
          setEndYear(v);
          if (v < startYear) setStartYear(v);
        }}
        className="rounded border bg-background px-1.5 py-0.5 text-xs text-foreground"
        aria-label="End year"
      >
        {Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map(
          (y) => (
            <option key={y} value={y} disabled={y < startYear}>
              {y}
            </option>
          )
        )}
      </select>
    </div>
  );
}
