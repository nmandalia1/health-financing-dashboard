"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getCountryMetadata, getMultipleIndicators } from "@/lib/queries";
import type { CountryMetadata, IndicatorGroup } from "@/lib/types";

// Coverage indicators are WUENIC (canonical WHO/UNICEF estimates, 1997–latest,
// 16 antigens). Financing indicators remain from the WHO JRF.
const IMMUNIZATION_INDICATORS = [
  // Financing (WHO JRF)
  "WHO_IMM_GOV_VAX_USD",   // Govt vaccine expenditure (USD)
  "WHO_IMM_TOT_VAX_USD",   // Total vaccine expenditure (USD)
  "WHO_IMM_GOV_SHARE",     // Govt share of vaccine spending (%)
  // Coverage (WUENIC)
  "WUENIC_BCG",
  "WUENIC_DTP1",
  "WUENIC_DTP3",
  "WUENIC_POL3",
  "WUENIC_MCV1",
  "WUENIC_MCV2",
  "WUENIC_HEPB3",
  "WUENIC_HEPBB",
  "WUENIC_HIB3",
  "WUENIC_PCV3",
  "WUENIC_ROTAC",
  "WUENIC_IPV1",
  "WUENIC_IPV2",
  "WUENIC_RCV1",
  "WUENIC_YFV",
  "WUENIC_MENGA",
];

export function useImmunizationData(iso3: string) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<IndicatorGroup | null>(null);
  const [metadata, setMetadata] = useState<CountryMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    Promise.all([
      getMultipleIndicators(conn, iso3, IMMUNIZATION_INDICATORS),
      getCountryMetadata(conn, iso3),
    ])
      .then(([d, m]) => {
        setData(d);
        setMetadata(m);
      })
      .catch((err) => console.error("Immunization data query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, iso3]);

  return { data, metadata, isLoading };
}
