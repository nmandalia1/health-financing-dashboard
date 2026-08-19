"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getCountryMetadata, getPeerPercentiles } from "@/lib/queries";
import type { PeerBandGroup } from "@/lib/types";

/**
 * Fetches income-group percentile bands (P25 / P50 / P75) for a set of
 * indicators, scoped to the same World Bank income group as `iso3`.
 *
 * The query runs once when DuckDB is ready and the iso3 changes.
 * Views should pass only the indicators they actually render, so the
 * DuckDB aggregation stays fast.
 */
export function usePeerBenchmarks(iso3: string, indicatorCodes: string[]) {
  const { conn } = useDuckDB();
  const [bands, setBands] = useState<PeerBandGroup | null>(null);
  const [incomeGroup, setIncomeGroup] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    setBands(null);
    setIncomeGroup(null);

    (async () => {
      const metadata = await getCountryMetadata(conn, iso3);
      const group = metadata?.wb_income_group ?? null;
      setIncomeGroup(group);
      if (group && indicatorCodes.length > 0) {
        const result = await getPeerPercentiles(conn, group, indicatorCodes);
        setBands(result);
      }
    })()
      .catch((err) => console.error("Peer benchmarks query failed:", err))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, iso3]);

  return { bands, incomeGroup, isLoading };
}
