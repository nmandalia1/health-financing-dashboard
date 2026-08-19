"use client";

import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { MapBar } from "@/components/layout/map-bar";
import { CountrySelector } from "@/components/country-selector/country-selector";
import { useCountryName } from "@/hooks/use-country-name";
import { resolveLocation } from "@/lib/nav-graph";
import { useLastCountry } from "@/lib/last-country";

/**
 * The chrome, mounted once in the root layout.
 *
 * Previously the header was rendered by eight different pages and the map by
 * one layout, which is why the PFM section had to grow its own back button and
 * why the map could not see two thirds of the app. Everything above the content
 * now comes from here, and every page renders only its content.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { scope, trail } = resolveLocation(pathname);
  // The remembered country, not just the one in the URL — the scope switch
  // names it on cross-country pages too, where the URL has no iso3.
  const iso3 = useLastCountry();
  const countryName = useCountryName(iso3);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader>
        {/* Named on walkthroughs too: the lens lane there points at country
            views, so the reader needs to know which country that is. */}
        {(scope === "country" ||
          trail.some((n) => n.kind === "narrative")) && (
          <>
            <span className="text-sm font-medium">{countryName ?? iso3}</span>
            <CountrySelector />
          </>
        )}
      </AppHeader>
      <MapBar countryName={countryName} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
