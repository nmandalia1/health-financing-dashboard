"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getMultipleIndicators } from "@/lib/queries";
import type { IndicatorGroup } from "@/lib/types";

/**
 * All indicator codes needed for View 5.3: Financial Protection & Equity.
 */
const PROTECTION_INDICATORS = [
  "GHED_oops_che",   // OOP % CHE — WHO 20% threshold
  "GHED_oop_pc_usd", // OOP per capita USD
  "GHED_ext_che",    // External % CHE
  "GHED_pvtd_che",   // Private domestic % CHE
  "GHED_cfa_che",    // Compulsory financing % CHE
  "SI.POV.DDAY",     // Poverty headcount $2.15/day %
  "SI.POV.GINI",     // Gini index
];

export function useProtectionData(iso3: string) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<IndicatorGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    getMultipleIndicators(conn, iso3, PROTECTION_INDICATORS)
      .then(setData)
      .catch((err) => console.error("Protection data query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, iso3]);

  return { data, isLoading };
}
