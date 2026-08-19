"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getMultipleIndicators } from "@/lib/queries";
import type { IndicatorGroup } from "@/lib/types";

const FISCAL_INDICATORS = [
  "GHED_gghed_gge",
  "GHED_gghed_gdp",
  "GHED_gge_gdp",
  "GC.REV.XGRT.GD.ZS",
  "GC.TAX.TOTL.GD.ZS",
  "GGXWDG_NGDP",
  "GGXCNL_NGDP",
  "PCPIPCH",
  "NGDP_RPCH",
];

export function useFiscalData(iso3: string) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<IndicatorGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    getMultipleIndicators(conn, iso3, FISCAL_INDICATORS)
      .then(setData)
      .catch((err) => console.error("Fiscal data query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, iso3]);

  return { data, isLoading };
}
