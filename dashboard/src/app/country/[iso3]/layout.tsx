"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MapPinOff } from "lucide-react";
import { Compass } from "@/components/layout/compass";
import { useDuckDB } from "@/lib/duckdb-provider";
import { getCountryMetadata } from "@/lib/queries";

/**
 * Country pages own only their content now — the header and the map bar come
 * from the root AppShell, so they are identical here and in the cross-country
 * scope. What is left is the one thing genuinely specific to this segment:
 * telling the reader when the country code doesn't exist.
 */
export default function CountryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ iso3: string }>();
  const iso3 = params.iso3.toUpperCase();
  const { conn } = useDuckDB();
  // null = still checking; true/false = resolved.
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    getCountryMetadata(conn, iso3).then((meta) => {
      if (!cancelled) setExists(Boolean(meta));
    });
    return () => {
      cancelled = true;
    };
  }, [conn, iso3]);

  if (exists === false) {
    return (
      <div className="p-4 md:p-6 lg:p-8">
        <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-4 rounded-lg border border-dashed bg-muted/20 px-8 py-16 text-center">
          <MapPinOff className="h-8 w-8 text-muted-foreground/60" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold">Country not found</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{iso3}</span> doesn&apos;t match any
              country in our database. Try searching for a country above, or
              return to the world map.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Back to world map
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 lg:p-8">
      {children}
      <Compass />
    </div>
  );
}
