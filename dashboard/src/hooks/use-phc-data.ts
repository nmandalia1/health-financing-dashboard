"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getMultipleIndicators } from "@/lib/queries";
import type { IndicatorGroup } from "@/lib/types";

const PHC_INDICATORS = [
  "GHED_phc_usd_pc",      // PHC per capita USD
  "GHED_phc_che",         // PHC as % CHE
  "GHED_gghed_phc_phc",   // Govt share of PHC %
  "HWF_0001",             // Doctors per 10,000
  "HWF_0007",             // Nurses & midwives per 10,000
  "HWF_0004",             // Dentists per 10,000
  "HWF_0006",             // Pharmacists per 10,000
  "SH.MED.BEDS.ZS",       // Hospital beds per 1,000
  // These were WHS4_543 / WHS4_100 / WHS4_544, which GHO publishes as BCG,
  // DTP3 and IPV immunisation coverage — not maternal care. Correct codes:
  "MDG_0000000025",            // Skilled birth attendance %
  "ANC_ATLEAST1VISIT_PERCENT", // Antenatal care ≥1 visit %
  "WHS4_154",                  // Antenatal care ≥4 visits %
];

export function usePhcData(iso3: string) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<IndicatorGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    getMultipleIndicators(conn, iso3, PHC_INDICATORS)
      .then(setData)
      .catch((err) => console.error("PHC data query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, iso3]);

  return { data, isLoading };
}
