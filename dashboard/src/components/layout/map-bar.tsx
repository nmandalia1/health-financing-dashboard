"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  TrendingUp,
  Shield,
  Target,
  Bug,
  Heart,
  Syringe,
  Landmark,
  ChevronDown,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import { useFiscalComposites } from "@/hooks/use-fiscal-composites";
import { bandColor } from "@/lib/fiscal-scoring";
import { useLastCountry } from "@/lib/last-country";
import {
  LENSES,
  NAV_NODES,
  childrenOf,
  narrativeFor,
  navIndicatorsForPillar,
  nodePath,
  resolveLocation,
  type LensId,
  type NavNode,
} from "@/lib/nav-graph";

/**
 * The map bar — the one surface that answers "where am I, what is beside me,
 * and what is deeper".
 *
 * It replaces map-nav.tsx, which only ever mounted under /country/* and only
 * knew how to expand Fiscal Space. Three differences:
 *
 *   1. It lives in the root layout, so it exists on every page.
 *   2. Scope is a switch that *keeps the lens* — the single change that stops
 *      the reader losing their place when they step between one country and all
 *      countries.
 *   3. Depth lanes are driven by each node's `expands` field, so Diseases and
 *      PFM get lanes without any code specific to them.
 */

const LENS_ICONS: Record<LensId, LucideIcon> = {
  landscape: BarChart3,
  fiscal: TrendingUp,
  protection: Shield,
  outcomes: Target,
  diseases: Bug,
  phc: Heart,
  immunization: Syringe,
  pfm: Landmark,
};

const CHIP =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors";
const CHIP_ACTIVE =
  "border-foreground/30 bg-muted font-medium text-foreground";
const CHIP_IDLE =
  "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground";
const CHIP_OFF =
  "border-dashed border-border/70 text-muted-foreground/45 cursor-not-allowed";

function Lane({
  label,
  divided,
  children,
}: {
  label: string;
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-2 overflow-x-auto py-1.5 ${
        divided ? "border-t" : ""
      }`}
    >
      <span className="w-[62px] shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A chip for a node that has nowhere to go yet. */
function PlannedChip({ node }: { node: NavNode }) {
  return (
    <span
      className={`${CHIP} ${CHIP_OFF}`}
      title={`${node.label} — not built yet. ${node.question}`}
      aria-disabled="true"
    >
      <span className="whitespace-nowrap">{node.short}</span>
    </span>
  );
}

function ScopeSwitch({
  activeScope,
  lens,
  iso3,
  countryName,
}: {
  activeScope: "country" | "global" | null;
  lens: LensId | null;
  iso3: string | null;
  countryName?: string;
}) {
  // Switching scope keeps the lens. With no lens (Compare, About) the switch
  // falls back to each scope's most useful entry point.
  const countryNode = lens ? NAV_NODES[`country.${lens}`] : null;
  const globalNode = lens ? NAV_NODES[`global.${lens}`] : null;

  const countryHref = iso3
    ? (countryNode ? nodePath(countryNode, iso3) : `/country/${iso3}`)
    : "/"; // no country in hand — send them to the picker
  const globalHref = globalNode ? nodePath(globalNode) : null;

  const base =
    "rounded-full px-2.5 py-1 text-xs transition-colors whitespace-nowrap";

  return (
    <div className="flex items-center gap-1 rounded-full border bg-muted/40 p-0.5">
      <Link
        href={countryHref ?? "/"}
        aria-current={activeScope === "country" ? "page" : undefined}
        className={`${base} ${
          activeScope === "country"
            ? "bg-background font-medium text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {countryName ?? (iso3 || "Pick a country")}
      </Link>
      {globalHref ? (
        <Link
          href={globalHref}
          aria-current={activeScope === "global" ? "page" : undefined}
          className={`${base} ${
            activeScope === "global"
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All countries
        </Link>
      ) : (
        <span
          className={`${base} cursor-not-allowed text-muted-foreground/45`}
          title={
            lens
              ? `${NAV_NODES[`global.${lens}`]?.label} across all countries isn't built yet.`
              : "This page has no cross-country view."
          }
          aria-disabled="true"
        >
          All countries
        </span>
      )}
    </div>
  );
}

/** The fiscal pillar lane carries scores, which no other lane has. */
function PillarChipDecor({
  pillarKey,
  iso3,
}: {
  pillarKey: string;
  iso3: string;
}) {
  const { latest } = useFiscalComposites(iso3);
  const score = latest?.[`pillar_${pillarKey}_score`] ?? null;
  if (score == null) return null;
  return (
    <b className="font-medium tabular-nums" style={{ color: bandColor(score) }}>
      {Math.round(score)}
    </b>
  );
}

export function MapBar({ countryName }: { countryName?: string }) {
  const pathname = usePathname();
  const { node, trail, scope, lens } = resolveLocation(pathname);
  const iso3 = useLastCountry();

  // The entry page is the map; it does not need a map bar above it.
  if (!node || node.id === "entry") return null;

  // A walkthrough is not a scope. Treating it as "the PFM lens at all-country
  // scope" made the bar claim a toggle position the reader never chose, and
  // greyed out the other seven lenses because their cross-country views do not
  // exist. It is its own kind of destination, so it gets its own lane and the
  // lens lane keeps pointing at country views you can actually reach.
  // Inherited down the walkthrough's own sections, so stepping into Chain or
  // Last mile does not flip the lens lane back to greyed-out cross-country
  // views the reader cannot use.
  const guideRoot = trail.find((n) => n.kind === "narrative") ?? null;
  const isGuide = guideRoot !== null;
  const lensScope = scope === "global" && !isGuide ? "global" : "country";
  const scopeForSwitch =
    !isGuide && (scope === "country" || scope === "global") ? scope : null;

  // Depth lanes: every ancestor that expands into routes contributes a lane of
  // its children, and the active node contributes its own if it expands too.
  const laneOwners = [...trail].filter(
    (n) => n.expands === "route" && n.id !== "entry"
  );
  if (node.expands === "route" && !laneOwners.includes(node)) {
    laneOwners.push(node);
  }

  return (
    <nav
      aria-label="Dashboard map"
      className="border-b bg-background px-4 md:px-6 lg:px-8"
    >
      {/* Where you are: a scope, or a guided read */}
      <Lane label={isGuide ? "Reading" : "Scope"}>
        {isGuide ? (
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 font-medium text-foreground">
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              {guideRoot?.label}
            </span>
            <span>a guided argument — read it in order</span>
          </span>
        ) : (
          <ScopeSwitch
            activeScope={scopeForSwitch}
            lens={lens}
            iso3={iso3}
            // Named in both scopes: on a cross-country page the switch still has
            // to say which country it would take you back to.
            countryName={countryName}
          />
        )}
      </Lane>

      {/* Lenses — always all eight, so any lens is one click from anywhere */}
      <Lane label="Lenses" divided>
        {LENSES.map((l) => {
          const target = NAV_NODES[`${lensScope}.${l.id}`];
          const href = nodePath(target, iso3 ?? undefined);
          const Icon = LENS_ICONS[l.id];
          // Active means this chip is on the path you took — the lens stays lit
          // while you are inside one of its pillars. Testing the trail rather
          // than the lens id also keeps it dark on a walkthrough, where the lens
          // matches but the chip points at the country profile instead.
          const active = trail.some((t) => t.id === target.id);

          // A lens's walkthrough sits beside it as its own destination rather
          // than behind the scope switch — it is a different kind of page, not
          // the same page at another scope, and a toggle hides what's on its
          // far side until you flip it.
          const guide = narrativeFor(l.id);
          const guideHref = guide ? nodePath(guide) : null;
          const onGuide = guide != null && trail.some((t) => t.id === guide.id);
          const guideChip =
            guide && guideHref ? (
              <Link
                key={`${l.id}-guide`}
                href={guideHref}
                aria-current={onGuide ? "page" : undefined}
                title={`${guide.label} — a guided walkthrough of the evidence`}
                className={`${CHIP} ${onGuide ? CHIP_ACTIVE : `${CHIP_IDLE} border-border/70`}`}
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{l.short} walkthrough</span>
              </Link>
            ) : null;

          if (!href || (target.path.includes(":iso3") && !iso3)) {
            return (
              <Fragment key={l.id}>
                <PlannedChip node={target} />
                {guideChip}
              </Fragment>
            );
          }
          return (
            <Fragment key={l.id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                title={target.question}
                className={`${CHIP} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{l.short}</span>
                {target.expands !== "none" && (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                )}
              </Link>
              {guideChip}
            </Fragment>
          );
        })}
      </Lane>

      {/* Depth — one lane per expanding ancestor, generically */}
      {laneOwners.map((owner) => {
        const kids = childrenOf(owner.id);
        if (kids.length === 0) return null;
        return (
          <Lane key={owner.id} label={owner.childLaneLabel ?? "More"} divided>
            {kids.map((kid) => {
              const href = nodePath(kid, iso3 ?? undefined);
              const active = trail.some((t) => t.id === kid.id);
              if (!href) return <PlannedChip key={kid.id} node={kid} />;
              return (
                <Link
                  key={kid.id}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  title={kid.question}
                  className={`${CHIP} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
                >
                  <span className="whitespace-nowrap">{kid.short}</span>
                  {owner.lens === "fiscal" && iso3 && (
                    <PillarChipDecor
                      pillarKey={kid.id.split(".").pop()!}
                      iso3={iso3}
                    />
                  )}
                  {kid.expands !== "none" && (
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  )}
                </Link>
              );
            })}
          </Lane>
        );
      })}

      {/* Anchors — the indicator catalogue on a pillar page */}
      {node.expands === "anchor" && iso3 && (
        <Lane label={node.childLaneLabel ?? "Detail"} divided>
          {navIndicatorsForPillar(node.id.split(".").pop()!).map((ind) => (
            <Link
              key={ind.code}
              href={`${nodePath(node, iso3)}#ind-${ind.code}`}
              className={`${CHIP} ${CHIP_IDLE} max-w-[180px]`}
              title={ind.label}
            >
              <span className="truncate">{ind.label}</span>
            </Link>
          ))}
        </Lane>
      )}
    </nav>
  );
}
