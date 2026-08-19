"use client";

import Link from "next/link";
import {
  BarChart3,
  Database,
  ExternalLink,
  GitBranch,
  Target,
} from "lucide-react";

const SOURCES = [
  {
    name: "WHO Global Health Expenditure Database (GHED)",
    url: "https://apps.who.int/nha/database",
    covers:
      "Current health expenditure, financing-source shares, PHC and primary-care spending.",
  },
  {
    name: "WHO Global Health Observatory (GHO)",
    url: "https://www.who.int/data/gho",
    covers:
      "Health outcomes, UHC Service Coverage Index, health workforce, disease burden.",
  },
  {
    name: "World Bank (WDI / HNP)",
    url: "https://data.worldbank.org/",
    covers:
      "Demographics, poverty, macroeconomic context, external debt, immunization coverage.",
  },
  {
    name: "IMF World Economic Outlook / Fiscal Monitor",
    url: "https://www.imf.org/en/Publications/SPROLLs/world-economic-outlook-databases",
    covers:
      "Government revenue, expenditure, debt and other fiscal-space indicators.",
  },
  {
    name: "WHO/UNICEF Joint Reporting Form",
    url: "https://immunizationdata.who.int/",
    covers:
      "Routine vaccine financing, government share, and antigen-specific coverage.",
  },
];

const BENCHMARKS = [
  { label: "Abuja Declaration", value: "15% of gov't expenditure on health", where: "Fiscal Space" },
  { label: "WHO financial protection", value: "Out-of-pocket < 20% of CHE", where: "Financial Protection" },
  { label: "WHO PHC minimum", value: "$86 per capita", where: "PHC & Service Delivery" },
  { label: "WHO workforce density", value: "4.45 per 1,000 (doctors + nurses + midwives)", where: "PHC & Service Delivery" },
  { label: "WHO high-coverage reference", value: "UHC service coverage index ≥ 80 (SDG 3.8 calls for universal coverage)", where: "Outcomes" },
  { label: "Routine immunization", value: "DPT3 coverage ≥ 90%", where: "Immunization" },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 py-10 md:py-16">
        <section>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            About
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            Methodology &amp; sources
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            This dashboard consolidates global health financing data from five
            authoritative sources into a single, coherent exploration tool.
            It's designed to make complex financing flows understandable in
            seconds, while staying honest about data limitations.
          </p>
        </section>

        <section>
          <SectionHeading icon={BarChart3} title="What this dashboard does" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Seven thematic views answer the core questions of health
            financing: where money comes from, whether governments can afford
            more, whether people are protected from impoverishment, what
            outcomes are achieved, how disease-specific programmes are
            funded, whether money reaches primary care, and whether
            immunization programmes are self-sustaining. Every view supports
            peer benchmarking against income-group percentiles.
          </p>
        </section>

        <section>
          <SectionHeading icon={Database} title="Data pipeline" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            A Python pipeline (see <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">pipeline/</code>{" "}
            in the repo) pulls indicators from each source, harmonises country
            codes via ISO3, applies source-priority rules for overlapping
            indicators, and writes a consolidated master parquet file. The
            dashboard loads this parquet directly in the browser via
            DuckDB-WASM — no backend server required. Re-running the pipeline
            is the only refresh step.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Coverage: <strong>101 indicators · 217 countries · 2000–2023</strong>.
          </p>
        </section>

        <section>
          <SectionHeading icon={ExternalLink} title="Data sources" />
          <ul className="divide-y rounded-lg border bg-card">
            {SOURCES.map((s) => (
              <li key={s.name} className="p-4">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-govt"
                >
                  {s.name}
                  <ExternalLink className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                </a>
                <p className="mt-1 text-xs text-muted-foreground">{s.covers}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionHeading icon={Target} title="International benchmarks used" />
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 font-medium">Benchmark</th>
                  <th className="p-3 font-medium">Value</th>
                  <th className="p-3 font-medium">Where it shows</th>
                </tr>
              </thead>
              <tbody>
                {BENCHMARKS.map((b) => (
                  <tr key={b.label} className="border-b last:border-0">
                    <td className="p-3 font-medium">{b.label}</td>
                    <td className="p-3 text-muted-foreground">{b.value}</td>
                    <td className="p-3 text-xs text-muted-foreground">{b.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <SectionHeading icon={GitBranch} title="Caveats" />
          <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>
              Reporting lag: the latest year with comprehensive coverage is
              typically 2–3 years behind the current year.
            </li>
            <li>
              Small island states and conflict-affected settings may have
              sparse or missing data — the dashboard displays what's
              reported, without imputation.
            </li>
            <li>
              Financing figures are in current US dollars unless otherwise
              noted — not adjusted for inflation or purchasing-power parity.
            </li>
            <li>
              When WHO GHED and World Bank disagree on a financing indicator,
              GHED is preferred (it's the authoritative National Health
              Accounts source).
            </li>
          </ul>
        </section>

        <section>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-govt hover:underline"
          >
            ← Back to the map
          </Link>
        </section>
      </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
}: {
  icon: typeof BarChart3;
  title: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-govt" />
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}
