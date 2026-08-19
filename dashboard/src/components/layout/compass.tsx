"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CornerDownRight, Compass as CompassIcon } from "lucide-react";
import { useLastCountry } from "@/lib/last-country";
import {
  NAV_NODES,
  edgesFor,
  needsCountry,
  nodePath,
  resolveLocation,
  type NavEdge,
} from "@/lib/nav-graph";

/**
 * The compass — "where else can I go, and how far is it from here".
 *
 * Replaces see-also.tsx, which held two hand-maintained maps of suggestions and
 * rendered them as one undifferentiated row. The destinations are the same; what
 * is new is that they come from the graph and arrive sorted by `proximity`, so
 * the reader can tell a next step in the same argument from a deliberate change
 * of angle without reading every card.
 */

function Group({
  title,
  hint,
  icon,
  edges,
  iso3,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  edges: NavEdge[];
  iso3: string | null;
}) {
  const cards = edges
    .map((edge) => {
      const target = NAV_NODES[edge.to];
      if (!target || target.status === "planned") return null;
      // A cross-scope hop may want a country we don't have. Rather than guess
      // one, send the reader to the picker.
      const wants = needsCountry(target);
      const href =
        wants && !iso3 ? "/" : nodePath(target, iso3 ?? undefined);
      if (!href) return null;
      return { edge, target, href, viaPicker: wants && !iso3 };
    })
    .filter((c) => c !== null);

  if (cards.length === 0) return null;

  return (
    <div>
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
        <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/60">
          {hint}
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ edge, target, href, viaPicker }) => (
          <Link
            key={edge.to}
            href={href}
            className="group flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/30 hover:bg-muted/30"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {target.label}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {edge.why}
              </p>
              {viaPicker && (
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Pick a country first
                </p>
              )}
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Compass() {
  const pathname = usePathname();
  const { node } = resolveLocation(pathname);
  const iso3 = useLastCountry();

  if (!node || node.id === "entry") return null;

  const { near, far } = edgesFor(node.id);
  if (near.length + far.length === 0) return null;

  return (
    <section className="mt-8 space-y-6 border-t pt-6">
      <Group
        title="Follows from this"
        hint="the same thread"
        icon={<CornerDownRight className="h-3.5 w-3.5" aria-hidden />}
        edges={near}
        iso3={iso3}
      />
      <Group
        title="A different angle"
        hint="steps outside this question"
        icon={<CompassIcon className="h-3.5 w-3.5" aria-hidden />}
        edges={far}
        iso3={iso3}
      />
    </section>
  );
}
