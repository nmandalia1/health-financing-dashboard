"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getCountryList } from "@/lib/queries";
import type { CountryListItem } from "@/lib/types";

export function useCountries() {
  const { conn } = useDuckDB();
  const [countries, setCountries] = useState<CountryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    getCountryList(conn)
      .then(setCountries)
      .finally(() => setIsLoading(false));
  }, [conn]);

  return { countries, isLoading };
}
