"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getCountryMetadata, getMultipleIndicators } from "@/lib/queries";
import type { IndicatorGroup } from "@/lib/types";

/**
 * All indicator codes needed for View 5.1: Financing Landscape.
 *
 * Uses the lowercase GHED codes from the GHED workbook (~4,600 country-years
 * each, 195 countries). The SHA2011 WHO-GHO mirror codes this page used to
 * warn about are gone: they were the same numbers truncated to 1,000 rows, and
 * the whole dashboard now reads these codes.
 */
const FINANCING_INDICATORS = [
  // Core SHA 2011 revenue-source decomposition (sums to 100% of CHE)
  "GHED_gghed_che", // Govt domestic (GGHE-D) % CHE
  "GHED_pvtd_che", // Private domestic (PVT-D) % CHE
  "GHED_ext_che", // External (EXT) % CHE
  "GHED_oops_che", // Out-of-pocket % CHE (subset of PVT-D)
  // Quality-of-financing: pooling & prepayment
  "GHED_cfa_che", // Compulsory Financing Arrangements % CHE (govt + compulsory insurance)
  // Level of spending
  "GHED_che_pc_usd", // CHE per capita (current USD)
  "GHED_che_usd2023_pc", // CHE per capita (constant 2023 USD) — real trend
  "GHED_che_gdp", // CHE % GDP
  // Government fiscal effort
  "GHED_gghed_gge", // Govt health % general-govt expenditure (Abuja target 15%)
  "GHED_gghed_gdp", // Govt health % GDP
  // Macro context
  "NGDPDPC", // GDP per capita (IMF WEO)
];

export function useFinancingData(iso3: string) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<IndicatorGroup | null>(null);
  const [countryName, setCountryName] = useState<string>(iso3);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    Promise.all([
      getMultipleIndicators(conn, iso3, FINANCING_INDICATORS),
      getCountryMetadata(conn, iso3),
    ])
      .then(([indicators, meta]) => {
        setData(indicators);
        if (meta) setCountryName(meta.country_name);
      })
      .catch((err) => console.error("Financing data query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, iso3]);

  return { data, countryName, isLoading };
}
