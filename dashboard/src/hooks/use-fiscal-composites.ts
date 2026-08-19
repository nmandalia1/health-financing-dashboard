"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import {
  getCountryMetadata,
  getFiscalComposites,
  getFiscalPeerMedians,
} from "@/lib/queries";
import type { FiscalCompositeRow, FiscalPeerMedians } from "@/lib/types";

/**
 * Loads the fiscal-space composite scores (Fiscal Space for Health Index and
 * the seven pillar sub-indices) for one country from mart_fiscal_space, plus
 * income-group peer medians for the "vs peers" markers.
 *
 * Degrades gracefully: if the mart isn't present (pipeline not run), `available`
 * is false and the verdict section simply doesn't render.
 */
export function useFiscalComposites(iso3: string) {
  const { conn } = useDuckDB();
  const [series, setSeries] = useState<FiscalCompositeRow[]>([]);
  const [peerMedians, setPeerMedians] = useState<FiscalPeerMedians | null>(null);
  const [incomeGroup, setIncomeGroup] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    setSeries([]);
    setPeerMedians(null);

    (async () => {
      try {
        const rows = await getFiscalComposites(conn, iso3);
        setSeries(rows);
        const meta = await getCountryMetadata(conn, iso3);
        const group = meta?.wb_income_group ?? null;
        setIncomeGroup(group);
        if (group) setPeerMedians(await getFiscalPeerMedians(conn, group));
        setAvailable(true);
      } catch (err) {
        console.warn("Fiscal composites unavailable (mart_fiscal_space):", err);
        setAvailable(false);
      }
    })().finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, iso3]);

  // Latest country-year that has a published index (sufficient pillar coverage).
  const latest =
    [...series].reverse().find((r) => r.fsh_index != null) ?? null;

  return { series, latest, peerMedians, incomeGroup, available, isLoading };
}
