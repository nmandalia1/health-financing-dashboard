"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import {
  getScatterData,
  getMultipleIndicators,
  getAnimatedScatterData,
} from "@/lib/queries";
import type {
  AnimatedScatterPoint,
  ScatterPoint,
  IndicatorGroup,
} from "@/lib/types";

/**
 * UHC service coverage sub-indices available in the current data pull.
 * UHC_SCI_CAPSP (Service capacity & access) is not included — WHO GHO
 * returned 0 rows for it, so we render the 3 available tracer arms.
 */
const UHC_RADAR_CODES = [
  "UHC_SCI_RMNCH",
  "UHC_SCI_INFECT",
  "UHC_SCI_NCD",
];

export const OUTCOME_OPTIONS = [
  { code: "WHOSIS_000001", label: "Life expectancy at birth", inverted: false },
  { code: "WHOSIS_000015", label: "Healthy life expectancy (HALE)", inverted: false },
  { code: "MDG_0000000001", label: "Under-5 mortality rate", inverted: true },
  { code: "MDG_0000000026", label: "Neonatal mortality rate", inverted: true },
  { code: "SH.STA.MMRT", label: "Maternal mortality ratio", inverted: true },
  { code: "UHC_INDEX_REPORTED", label: "UHC Service Coverage Index", inverted: false },
] as const;

export function useScatterData(yIndicator: string) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<ScatterPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    getScatterData(conn, "GHED_che_pc_usd", yIndicator)
      .then(setData)
      .catch((err) => console.error("Scatter query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, yIndicator]);

  return { data, isLoading };
}

export function useAnimatedScatterData(yIndicator: string, enabled: boolean) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<AnimatedScatterPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!conn || !enabled) return;
    setIsLoading(true);
    getAnimatedScatterData(conn, "GHED_che_pc_usd", yIndicator)
      .then(setData)
      .catch((err) => console.error("Animated scatter query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, yIndicator, enabled]);

  return { data, isLoading };
}

export function useRadarData(iso3: string) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<IndicatorGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    getMultipleIndicators(conn, iso3, UHC_RADAR_CODES)
      .then(setData)
      .catch((err) => console.error("Radar query failed:", err))
      .finally(() => setIsLoading(false));
  }, [conn, iso3]);

  return { data, isLoading };
}
