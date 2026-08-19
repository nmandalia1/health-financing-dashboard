"use client";

import { useEffect, useState, useCallback } from "react";
import { useDuckDB } from "@/lib/duckdb-provider";
import {
  getPfmScatter,
  getPfmCorrelation,
  getPfmCountryList,
  pfmMartsAvailable,
} from "@/lib/pfm-queries";
import type {
  PfmScatterPoint,
  PfmScoreCode,
  PfmOutcomeCode,
} from "@/lib/pfm-types";

export interface PfmScatterState {
  points: PfmScatterPoint[];
  r: number | null;
  n: number;
  isLoading: boolean;
  martsAvailable: boolean | null; // null = still checking
}

/**
 * Loads scatter data for the PFM × health landing view.
 * Re-fetches whenever the selected score/outcome or filter options change.
 */
export function usePfmScatter(
  scoreCode: PfmScoreCode,
  outcomeCode: PfmOutcomeCode,
  opts: { ssaOnly?: boolean; minYear?: number } = {},
): PfmScatterState {
  const { conn } = useDuckDB();
  const [points, setPoints] = useState<PfmScatterPoint[]>([]);
  const [r, setR] = useState<number | null>(null);
  const [n, setN] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [martsAvailable, setMartsAvailable] = useState<boolean | null>(null);

  const ssaOnly = opts.ssaOnly ?? false;
  const minYear = opts.minYear ?? 2005;

  useEffect(() => {
    if (!conn) return;
    let cancelled = false;

    setIsLoading(true);
    (async () => {
      try {
        const available = await pfmMartsAvailable(conn);
        if (cancelled) return;
        setMartsAvailable(available);
        if (!available) {
          setIsLoading(false);
          return;
        }
        const [pts, corr] = await Promise.all([
          getPfmScatter(conn, scoreCode, outcomeCode, { ssaOnly, minYear }),
          getPfmCorrelation(conn, scoreCode, outcomeCode, { ssaOnly }),
        ]);
        if (cancelled) return;
        setPoints(pts);
        setR(corr.r);
        setN(corr.n);
      } catch (err) {
        console.error("PFM scatter query failed:", err);
        if (!cancelled) setMartsAvailable(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conn, scoreCode, outcomeCode, ssaOnly, minYear]);

  return { points, r, n, isLoading, martsAvailable };
}

/** Country list for the PFM country selector (countries with ≥1 PEFA assessment). */
export function usePfmCountryList() {
  const { conn } = useDuckDB();
  const [countries, setCountries] = useState<
    Array<{ iso3: string; country_name: string; n_assessments: number }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conn) return;
    setIsLoading(true);
    getPfmCountryList(conn)
      .then(setCountries)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [conn]);

  return { countries, isLoading };
}
