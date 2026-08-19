"use client";

import { useEffect, useState } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getCountryMetadata } from "@/lib/queries";

/**
 * A country's display name, falling back to its ISO3 code until it resolves.
 *
 * Views used to derive this from whatever dataset they happened to load, which
 * meant a view whose data carried no `country_name` column showed the raw code
 * next to the header's proper name. Resolving it from country metadata instead
 * gives every surface the same answer.
 */
export function useCountryName(iso3: string | null | undefined): string | undefined {
  const { conn } = useDuckDB();
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!conn || !iso3) return;
    let cancelled = false;
    getCountryMetadata(conn, iso3).then((meta) => {
      if (cancelled || !meta) return;
      setNames((prev) =>
        prev[iso3] ? prev : { ...prev, [iso3]: meta.country_name }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [conn, iso3]);

  return iso3 ? (names[iso3] ?? iso3) : undefined;
}
