"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorldMap } from "@/components/landing/world-map";
import { useCountries } from "@/hooks/use-countries";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

const INCOME_GROUPS = [
  "Low income",
  "Lower middle income",
  "Upper middle income",
  "High income",
];

export default function Home() {
  const router = useRouter();
  const { countries, isLoading } = useCountries();
  const [search, setSearch] = useState("");
  const [incomeFilter, setIncomeFilter] = useState<string | null>(null);

  const filtered = countries
    .filter((c) => !incomeFilter || c.wb_income_group === incomeFilter)
    .filter((c) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        c.country_name.toLowerCase().includes(s) ||
        c.iso3.toLowerCase().includes(s)
      );
    })
    .slice(0, 50);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 md:py-12">
        <section className="text-center">
          {/* Scope only. The source organisations used to sit here as bare
              names next to the dashboard's own title, which reads as
              endorsement; they are now stated as provenance below. */}
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-govt" />
            217 countries · 2000–2024
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Who pays for health — and who is protected
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
            Revenue sources, out-of-pocket burden and service coverage across
            217 countries — then open any country for its full financing
            profile and fiscal space.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-xs leading-relaxed text-muted-foreground/70">
            Built on published data from the WHO Global Health Expenditure
            Database, WHO GHO, the World Bank and the IMF. Expenditure follows
            the SHA 2011 boundary. An independent project — not affiliated with,
            or endorsed by, those organisations.{" "}
            <Link href="/about" className="underline underline-offset-2 hover:text-foreground">
              Sources and methods
            </Link>
          </p>
        </section>

        <section>
          <Suspense>
            <WorldMap />
          </Suspense>
        </section>

        <section className="mx-auto w-full max-w-md">
          <div className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Or search for a country
          </div>
          <div className="rounded-lg border bg-card shadow-sm">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search by name or ISO3 code…"
                value={search}
                onValueChange={setSearch}
              />
              <div className="flex flex-wrap gap-1 px-3 py-2">
                {INCOME_GROUPS.map((group) => (
                  <Badge
                    key={group}
                    variant={incomeFilter === group ? "default" : "outline"}
                    className="cursor-pointer text-[10px]"
                    onClick={() =>
                      setIncomeFilter(incomeFilter === group ? null : group)
                    }
                  >
                    {group.replace(" income", "")}
                  </Badge>
                ))}
              </div>
              <CommandList>
                {isLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Loading countries…
                  </div>
                ) : (
                  <>
                    <CommandEmpty>No countries found.</CommandEmpty>
                    <CommandGroup>
                      {filtered.map((country) => (
                        <CommandItem
                          key={country.iso3}
                          value={country.iso3}
                          onSelect={() =>
                            router.push(`/country/${country.iso3}`)
                          }
                          className="flex items-center justify-between"
                        >
                          <span>{country.country_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {country.iso3}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </div>
        </section>
      </div>
  );
}
