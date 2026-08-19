"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { resolveLocation } from "@/lib/nav-graph";

/**
 * Remembers the country the reader last looked at.
 *
 * The scope switch has to work in both directions, but a cross-country page has
 * no iso3 anywhere in its URL. Without a memory, switching from "All countries ›
 * PFM" back to country scope would have to dump the reader at the picker every
 * time — which is exactly the lens-loss the redesign exists to fix. Session
 * storage keeps it to the current tab, so a shared link never carries someone
 * else's country.
 *
 * Modelled as an external store rather than component state: sessionStorage is
 * genuinely external, unavailable during server render, and written from more
 * than one place.
 */

const KEY = "hfd:last-country";

const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    // Private mode or blocked storage — the picker fallback still works.
    return null;
  }
}

/** Server and first client render agree on null, so hydration stays stable. */
function getServerSnapshot(): string | null {
  return null;
}

function remember(iso3: string): void {
  try {
    if (sessionStorage.getItem(KEY) === iso3) return;
    sessionStorage.setItem(KEY, iso3);
  } catch {
    return;
  }
  for (const fn of listeners) fn();
}

const LastCountryContext = createContext<string | null>(null);

export function LastCountryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const fromUrl = resolveLocation(pathname).iso3;
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (fromUrl) remember(fromUrl);
  }, [fromUrl]);

  return (
    <LastCountryContext.Provider value={fromUrl ?? stored}>
      {children}
    </LastCountryContext.Provider>
  );
}

/** The country in the URL, or the last one visited this session, or null. */
export function useLastCountry(): string | null {
  return useContext(LastCountryContext);
}
