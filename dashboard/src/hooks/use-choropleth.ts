"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getChoroplethData } from "@/lib/queries";
import type { ChoroplethPoint } from "@/lib/types";

export function useChoropleth(indicatorCode: string, sinceYear = 2015) {
  const { conn } = useDuckDB();
  const [data, setData] = useState<ChoroplethPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    getChoroplethData(conn, indicatorCode, sinceYear)
      .then(setData)
      .finally(() => setIsLoading(false));
  }, [conn, indicatorCode, sinceYear]);

  return { data, isLoading };
}
