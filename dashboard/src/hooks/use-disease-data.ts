"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getMultipleIndicators } from "@/lib/queries";
import type { IndicatorGroup } from "@/lib/types";

const DISEASE_INDICATORS = [
  // HIV / AIDS — fallbacks used only where UNAIDS has no data for a country
  "SH.HIV.ARTC.ZS",   // ART coverage (%) — World Bank
  "HIV_0000000006",   // HIV-related deaths (number) — WHO GHO
  // HIV / AIDS — UNAIDS AIDSinfo (primary source)
  "UNAIDS_PLHIV",             // People living with HIV (number)
  "UNAIDS_NEW_INFECTIONS",    // New HIV infections (number)
  "UNAIDS_AIDS_DEATHS",       // AIDS-related deaths (number)
  "UNAIDS_PREVALENCE_ADULTS", // HIV prevalence, adults 15–49 (%)
  "UNAIDS_INCIDENCE_RATE",    // HIV incidence (per 1,000 uninfected)
  "UNAIDS_95_DIAGNOSED",      // PLHIV who know their status (%)
  "UNAIDS_95_ON_ART",         // Diagnosed PLHIV on ART (%)
  "UNAIDS_95_SUPPRESSED",     // PLHIV on ART with viral suppression (%)
  "UNAIDS_PMTCT",             // PMTCT — ART coverage for pregnant women (%)
  "UNAIDS_ART_COVERAGE",      // ART coverage (%)
  "UNAIDS_FIN_TOTAL",         // Total HIV financing (USD) = Gov + Private + International
  "UNAIDS_FIN_DOMESTIC_GOV",  // Domestic government HIV financing (USD)
  "UNAIDS_FIN_DOMESTIC_PRIV", // Domestic private HIV financing (USD)
  "UNAIDS_FIN_INTERNATIONAL", // International HIV financing received (USD)
  "UNAIDS_FIN_GLOBAL_FUND",   // Global Fund HIV financing (USD)
  "UNAIDS_FIN_PEPFAR",        // PEPFAR HIV financing (USD)
  // Tuberculosis
  "SH.TBS.INCD",      // TB incidence (per 100k)
  "MDG_0000000017",   // TB mortality (per 100k)
  // Malaria
  "MALARIA_EST_INCIDENCE",
  "MALARIA_EST_MORTALITY",
  "MALARIA_EST_CASES",
  "MALARIA_EST_DEATHS",
  "MALARIA_ITN_COVERAGE",
  // NCDs & Mental Health
  "NCD_CCS_Hypertension",   // Raised blood pressure prevalence (18+)
  "NCD_GLUC_04",             // Raised blood glucose / diabetes (18+)
  "NCD_BMI_30A",             // Obesity prevalence, adults
  "NCD_PAC_A",               // Physical inactivity, adults
  "SDGSUICIDE",              // Crude suicide rate (per 100,000)
  "SA_0000001688",           // Alcohol use disorders (15+, %)
  "MH_12",                   // Mental health outpatient rate (per 100,000)
  // Cross-cutting: external financing
  "GHED_ext_che",
];

export function useDiseaseData(iso3: string) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<IndicatorGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    getMultipleIndicators(conn, iso3, DISEASE_INDICATORS)
      .then(setData)
      .catch((err) => console.error("Disease data query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, iso3]);

  return { data, isLoading };
}
