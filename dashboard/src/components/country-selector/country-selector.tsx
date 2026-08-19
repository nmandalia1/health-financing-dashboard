"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { useCountries } from "@/hooks/use-countries";

const INCOME_GROUPS = [
  "Low income",
  "Lower middle income",
  "Upper middle income",
  "High income",
];

export function CountrySelector() {
  const router = useRouter();
  const { countries, isLoading } = useCountries();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [incomeFilter, setIncomeFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = countries;
    if (incomeFilter) {
      list = list.filter((c) => c.wb_income_group === incomeFilter);
    }
    return list;
  }, [countries, incomeFilter]);

  function handleSelect(iso3: string) {
    setOpen(false);
    setSearch("");
    router.push(`/country/${iso3}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground">
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search countries</span>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or ISO3..."
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
                Loading countries...
              </div>
            ) : (
              <>
                <CommandEmpty>No countries found.</CommandEmpty>
                <CommandGroup>
                  {filtered
                    .filter((c) => {
                      if (!search) return true;
                      const s = search.toLowerCase();
                      return (
                        c.country_name.toLowerCase().includes(s) ||
                        c.iso3.toLowerCase().includes(s)
                      );
                    })
                    .slice(0, 50)
                    .map((country) => (
                      <CommandItem
                        key={country.iso3}
                        value={country.iso3}
                        onSelect={() => handleSelect(country.iso3)}
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
      </PopoverContent>
    </Popover>
  );
}
