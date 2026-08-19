/**
 * nav-graph.ts — single source of truth for every navigable place in the app.
 *
 * The dashboard is located on three axes rather than by which route tree a page
 * happens to live in:
 *
 *   scope   country | global (cross-country) | entry | utility
 *   lens    the thematic question being asked — shared across both scopes, so
 *           switching scope keeps the lens ("Kenya › PFM" ⇄ "All countries › PFM")
 *   depth   0 entry · 1 lens · 2 component · 3 indicator
 *
 * Every surface (map bar, compass footer, world map, overlay) reads this graph;
 * none of them keeps its own list. Two fields carry most of the weight:
 *
 *   `expands`   how a node reveals its children, so a surface can render depth
 *               generically instead of special-casing Fiscal Space.
 *   `proximity` on each edge — "near" is the same thread of argument, "far" is a
 *               different angle. This is what splits "where else can I go" into
 *               two meaningfully different groups.
 *
 * Pillars, indicators and disease sub-views are derived from the registries so
 * the graph can never drift from the content it points at.
 */

import { INDICATOR_REGISTRY, PILLARS } from "@/lib/indicator-registry";
import { FISCAL_PILLAR_KEYS } from "@/lib/queries";
import { PILLAR_QUESTIONS } from "@/lib/fiscal-scoring";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Scope = "country" | "global" | "entry" | "utility";

export type LensId =
  | "landscape"
  | "fiscal"
  | "protection"
  | "outcomes"
  | "diseases"
  | "phc"
  | "immunization"
  | "pfm";

/** How a node reveals its children. */
export type Expands =
  | "route" // children are real pages
  | "anchor" // children are scroll targets on this page (#ind-<code>)
  | "none";

export type EdgeKind =
  | "constrains" // upstream condition: revenue → prioritisation
  | "explains" // evidence for: efficiency → outcomes
  | "drills-into"
  | "rolls-up"
  | "same-lens-other-scope" // Kenya PFM ⇄ all-country PFM
  | "contrasts"; // → compare

/** near = the same thread of argument; far = a deliberately different angle. */
export type Proximity = "near" | "far";

export interface NavEdge {
  to: NodeId;
  kind: EdgeKind;
  proximity: Proximity;
  /** Why this destination matters *from here*. Shown on the card. */
  why: string;
}

export type NodeId = string;

export interface NavNode {
  id: NodeId;
  scope: Scope;
  lens: LensId | null;
  depth: 0 | 1 | 2 | 3;
  /** Path template. ":iso3" is substituted by `nodePath()`. */
  path: string;
  label: string;
  /** Chip-length label. */
  short: string;
  /** The one question this page answers. */
  question: string;
  parent: NodeId | null;
  expands: Expands;
  /**
   * What kind of page this is. Most of the dashboard is "reference" — a panel of
   * indicators you scan. A "narrative" page argues a case in a fixed reading
   * order (the PFM landing's evidence walk-through). The distinction is real and
   * was previously unmodelled, which is why PFM sat awkwardly outside the lens
   * grid: it is not a misfit, it is a different node type, and every lens can
   * eventually carry one.
   */
  kind: "reference" | "narrative";
  /**
   * "live" = there is somewhere to navigate to, whether at `path` or still at
   * `legacyPath`. "planned" = nothing to click yet; surfaces render these as
   * disabled chips, so the shape of the dashboard stays legible before every
   * cell is populated.
   */
  status: "live" | "planned";
  /** Where this content lives today, if it has not moved to `path` yet. */
  legacyPath?: string;
  /** Indicator codes this node needs; lets nav grey out empty destinations. */
  requires?: string[];
  /** What to call this node's lane of children in the map bar. */
  childLaneLabel?: string;
  edges: NavEdge[];
}

// ─── Lenses ─────────────────────────────────────────────────────────────────

export interface Lens {
  id: LensId;
  label: string;
  short: string;
  question: string;
  /** Path segment under the scope root. "" is the scope's own root page. */
  seg: string;
}

export const LENSES: Lens[] = [
  {
    id: "landscape",
    label: "Financing Landscape",
    short: "Landscape",
    question: "Where does the money come from?",
    seg: "",
  },
  {
    id: "fiscal",
    label: "Fiscal Space for Health",
    short: "Fiscal Space",
    question: "Is there room to spend more on health?",
    seg: "fiscal",
  },
  {
    id: "protection",
    label: "Financial Protection",
    short: "Protection",
    question: "What do households bear?",
    seg: "protection",
  },
  {
    id: "outcomes",
    label: "Outcomes & Value",
    short: "Outcomes",
    question: "Is spending producing health?",
    seg: "outcomes",
  },
  {
    id: "diseases",
    label: "Disease Financing",
    short: "Diseases",
    question: "Does disease financing match the burden?",
    seg: "diseases",
  },
  {
    id: "phc",
    label: "Primary Health Care",
    short: "PHC",
    question: "Is primary care funded?",
    seg: "phc",
  },
  {
    id: "immunization",
    label: "Immunization",
    short: "Immunization",
    question: "Are vaccines sustainably financed?",
    seg: "immunization",
  },
  {
    id: "pfm",
    label: "PFM & Health",
    short: "PFM",
    // Deliberately not the pillar's question. The pillar asks whether execution
    // is good enough to score; the lens asks what the money actually does.
    question: "Does budget management get money to the front line?",
    seg: "pfm",
  },
];

export const LENS_BY_ID = Object.fromEntries(
  LENSES.map((l) => [l.id, l])
) as Record<LensId, Lens>;

// ─── Disease sub-views ──────────────────────────────────────────────────────

export const DISEASES = [
  { key: "hiv", label: "HIV / AIDS", short: "HIV" },
  { key: "tb", label: "Tuberculosis", short: "TB" },
  { key: "malaria", label: "Malaria", short: "Malaria" },
  { key: "ncds", label: "NCDs & Mental Health", short: "NCDs" },
] as const;

// ─── Node construction ──────────────────────────────────────────────────────

const COUNTRY_ROOT = "/country/:iso3";
const GLOBAL_ROOT = "/global";

/** Which lenses have cross-country content today. Decision: ship the scope
 *  switch with the rest disabled rather than hide the roadmap. */
const GLOBAL_LIVE: ReadonlySet<LensId> = new Set<LensId>(["pfm"]);

function countryLensNode(lens: Lens): NavNode {
  return {
    id: `country.${lens.id}`,
    scope: "country",
    lens: lens.id,
    depth: 1,
    path: lens.seg ? `${COUNTRY_ROOT}/${lens.seg}` : COUNTRY_ROOT,
    label: lens.label,
    short: lens.short,
    question: lens.question,
    parent: "entry",
    expands:
      lens.id === "fiscal" || lens.id === "diseases" ? "route" : "none",
    ...(lens.id === "fiscal"
      ? { childLaneLabel: "Pillars" }
      : lens.id === "diseases"
        ? { childLaneLabel: "Diseases" }
        : {}),
    kind: "reference",
    status: "live",
    edges: [],
  };
}

function globalLensNode(lens: Lens): NavNode {
  return {
    id: `global.${lens.id}`,
    scope: "global",
    lens: lens.id,
    depth: 1,
    path: lens.seg ? `${GLOBAL_ROOT}/${lens.seg}` : `${GLOBAL_ROOT}/landscape`,
    label: lens.label,
    short: lens.short,
    question: `Across countries — ${lens.question.toLowerCase()}`,
    parent: "entry",
    expands: lens.id === "pfm" ? "route" : "none",
    ...(lens.id === "pfm" ? { childLaneLabel: "Sections" } : {}),
    // The PFM overview argues a case in a fixed reading order rather than
    // presenting a panel. That is a node type, not an exception.
    kind: lens.id === "pfm" ? "narrative" : "reference",
    status: GLOBAL_LIVE.has(lens.id) ? "live" : "planned",
    edges: [],
  };
}

function pillarNode(key: string): NavNode {
  const label = PILLARS[key as keyof typeof PILLARS];
  return {
    id: `country.fiscal.${key}`,
    scope: "country",
    lens: "fiscal",
    depth: 2,
    path: `${COUNTRY_ROOT}/fiscal/${key}`,
    label,
    short: label,
    question: PILLAR_QUESTIONS[key] ?? label,
    parent: "country.fiscal",
    expands: "anchor",
    childLaneLabel: "Indicators",
    kind: "reference",
    status: "live",
    requires: indicatorCodesForPillar(key),
    edges: [],
  };
}

function diseaseNode(d: (typeof DISEASES)[number]): NavNode {
  return {
    id: `country.diseases.${d.key}`,
    scope: "country",
    lens: "diseases",
    depth: 2,
    path: `${COUNTRY_ROOT}/diseases/${d.key}`,
    label: d.label,
    short: d.short,
    question: `Is ${d.short} financing matched to its burden?`,
    parent: "country.diseases",
    expands: "none",
    kind: "reference",
    status: "live",
    edges: [],
  };
}

const STATIC_NODES: NavNode[] = [
  {
    id: "entry",
    scope: "entry",
    lens: null,
    depth: 0,
    path: "/",
    label: "World map",
    short: "World",
    question: "Which countries look like what?",
    parent: null,
    expands: "route",
    childLaneLabel: "Lenses",
    kind: "reference",
    status: "live",
    edges: [],
  },
  {
    id: "global.pfm.chain",
    scope: "global",
    lens: "pfm",
    depth: 2,
    path: `${GLOBAL_ROOT}/pfm/chain`,
    label: "Budget execution chain",
    short: "Chain",
    question: "Where does money leak on the way down?",
    parent: "global.pfm",
    expands: "none",
    kind: "reference",
    status: "live",
    edges: [],
  },
  {
    id: "global.pfm.last-mile",
    scope: "global",
    lens: "pfm",
    depth: 2,
    path: `${GLOBAL_ROOT}/pfm/last-mile`,
    label: "The last mile",
    short: "Last mile",
    question: "Does cash reach front-line facilities?",
    parent: "global.pfm",
    expands: "none",
    kind: "reference",
    status: "live",
    edges: [],
  },
  {
    id: "compare",
    scope: "utility",
    lens: null,
    depth: 1,
    path: "/compare",
    label: "Compare countries",
    short: "Compare",
    question: "How do these countries differ?",
    parent: "entry",
    expands: "none",
    kind: "reference",
    status: "live",
    edges: [],
  },
  {
    id: "about",
    scope: "utility",
    lens: null,
    depth: 1,
    path: "/about",
    label: "About & sources",
    short: "About",
    question: "Where does the data come from?",
    parent: "entry",
    expands: "none",
    kind: "reference",
    status: "live",
    edges: [],
  },
];

// ─── The graph ──────────────────────────────────────────────────────────────

const ALL_NODES: NavNode[] = [
  ...STATIC_NODES,
  ...LENSES.map(countryLensNode),
  ...LENSES.map(globalLensNode),
  ...FISCAL_PILLAR_KEYS.map(pillarNode),
  ...DISEASES.map(diseaseNode),
];

export const NAV_NODES: Record<NodeId, NavNode> = Object.fromEntries(
  ALL_NODES.map((n) => [n.id, n])
);

// ─── Edges ──────────────────────────────────────────────────────────────────
// Ported from see-also.tsx, now typed by relation and proximity. "near" edges
// continue the current thread; "far" edges deliberately change the angle.

const EDGES: Array<[NodeId, NavEdge]> = [
  // Financing landscape
  ["country.landscape", { to: "country.fiscal", kind: "constrains", proximity: "near", why: "How much room is there to spend more on health?" }],
  ["country.landscape", { to: "country.protection", kind: "explains", proximity: "near", why: "When households pay this much, what's the burden?" }],
  ["country.landscape", { to: "country.outcomes", kind: "explains", proximity: "far", why: "Are these spending patterns producing health?" }],

  // Fiscal space
  ["country.fiscal", { to: "country.protection", kind: "explains", proximity: "near", why: "Where public space is tight, households often pay more." }],
  ["country.fiscal", { to: "country.landscape", kind: "rolls-up", proximity: "near", why: "See the full source decomposition behind the headline." }],
  ["country.fiscal", { to: "compare", kind: "contrasts", proximity: "far", why: "Put this country's fiscal profile alongside regional peers." }],

  // Protection
  ["country.protection", { to: "country.fiscal.prioritisation", kind: "constrains", proximity: "near", why: "OOP often falls when public health spending rises." }],
  ["country.protection", { to: "country.landscape", kind: "rolls-up", proximity: "near", why: "Trace pooled vs household financing over time." }],

  // Outcomes
  ["country.outcomes", { to: "country.fiscal.efficiency", kind: "explains", proximity: "near", why: "Outcomes vs spending — the value-for-money picture." }],
  ["country.outcomes", { to: "country.phc", kind: "explains", proximity: "far", why: "PHC is where outcomes are most often won or lost." }],

  // Diseases
  ["country.diseases", { to: "country.fiscal.external", kind: "constrains", proximity: "near", why: "Disease programmes are most exposed to aid shifts." }],
  ["country.diseases", { to: "country.protection", kind: "explains", proximity: "far", why: "Disease costs are a common source of household hardship." }],

  // PHC
  ["country.phc", { to: "country.outcomes", kind: "explains", proximity: "near", why: "PHC investment should show up in maternal & child outcomes." }],
  ["country.phc", { to: "country.fiscal.prioritisation", kind: "constrains", proximity: "far", why: "Is the budget being aimed at primary care?" }],

  // Immunization
  ["country.immunization", { to: "country.fiscal.external", kind: "constrains", proximity: "near", why: "Gavi co-financing and graduation drive vaccine sustainability." }],
  ["country.immunization", { to: "country.diseases", kind: "contrasts", proximity: "far", why: "Compare vaccine spend with HIV/TB/malaria programmes." }],

  // Pillars
  ["country.fiscal.macro", { to: "country.fiscal.revenue", kind: "constrains", proximity: "near", why: "Growth expands the envelope; revenue captures the share." }],
  ["country.fiscal.macro", { to: "country.fiscal.debt", kind: "constrains", proximity: "near", why: "Macro conditions shape future borrowing room." }],
  ["country.fiscal.revenue", { to: "country.fiscal.prioritisation", kind: "constrains", proximity: "near", why: "Once revenue is mobilised, share decides the health envelope." }],
  ["country.fiscal.revenue", { to: "country.fiscal.pfm", kind: "constrains", proximity: "far", why: "Revenue without execution still leaves services short." }],
  ["country.fiscal.prioritisation", { to: "country.fiscal.revenue", kind: "rolls-up", proximity: "near", why: "A bigger envelope makes prioritisation easier." }],
  ["country.fiscal.prioritisation", { to: "country.protection", kind: "explains", proximity: "far", why: "Higher public share usually means lower OOP." }],
  ["country.fiscal.external", { to: "country.fiscal.prioritisation", kind: "constrains", proximity: "near", why: "Transition risk grows when domestic share is low." }],
  ["country.fiscal.external", { to: "country.immunization", kind: "explains", proximity: "far", why: "Gavi co-financing is the canonical transition story." }],
  ["country.fiscal.debt", { to: "country.fiscal.prioritisation", kind: "constrains", proximity: "near", why: "Where debt service crowds in, health share often retreats." }],
  ["country.fiscal.debt", { to: "country.fiscal.macro", kind: "rolls-up", proximity: "near", why: "Growth and inflation drive the debt path." }],
  ["country.fiscal.efficiency", { to: "country.outcomes", kind: "explains", proximity: "near", why: "The outcomes side of the value-for-money picture." }],
  ["country.fiscal.efficiency", { to: "country.fiscal.pfm", kind: "constrains", proximity: "near", why: "Execution quality conditions whether spend converts." }],
  ["country.fiscal.pfm", { to: "country.fiscal.efficiency", kind: "explains", proximity: "near", why: "Strong PFM is what lets spending convert to outcomes." }],
  ["country.fiscal.pfm", { to: "country.pfm", kind: "drills-into", proximity: "near", why: "This score is one of seven index inputs — see the PFM system behind it." }],
];

// The scope pairing is mechanical: every lens links to itself in the other
// scope. This is the edge that makes a lens survive a scope change.
for (const lens of LENSES) {
  EDGES.push([
    `country.${lens.id}`,
    {
      to: `global.${lens.id}`,
      kind: "same-lens-other-scope",
      proximity: "far",
      why: "The same question asked across every country.",
    },
  ]);
  EDGES.push([
    `global.${lens.id}`,
    {
      to: `country.${lens.id}`,
      kind: "same-lens-other-scope",
      proximity: "far",
      why: "The same question narrowed to one country.",
    },
  ]);
}

// The two PFM sub-pages are dead ends today — nothing on them links anywhere.
EDGES.push(
  ["global.pfm.chain", { to: "global.pfm.last-mile", kind: "explains", proximity: "near", why: "Where the chain ends — whether cash reaches the facility." }],
  ["global.pfm.last-mile", { to: "global.pfm.chain", kind: "rolls-up", proximity: "near", why: "The upstream steps that decide what arrives." }],
  ["global.pfm.chain", { to: "country.pfm", kind: "same-lens-other-scope", proximity: "far", why: "Read one country's execution record end to end." }],
  ["global.pfm.last-mile", { to: "country.pfm", kind: "same-lens-other-scope", proximity: "far", why: "See how a single country scores on PI-23." }]
);

// The country PFM profile rolls back up to the pillar that scores it.
EDGES.push([
  "country.pfm",
  {
    to: "country.fiscal.pfm",
    kind: "rolls-up",
    proximity: "near",
    why: "How this profile is scored as 1 of 7 fiscal-space pillars.",
  },
]);

// Stepping out to peers is always a legitimately different angle, so every
// country node carries one. Without this the pillar pages render an empty
// "different angle" group — their hand-written edges are all same-thread.
for (const node of ALL_NODES) {
  if (node.scope !== "country") continue;
  EDGES.push([
    node.id,
    {
      to: "compare",
      kind: "contrasts",
      proximity: "far",
      why: `Line ${node.label} up against peer countries.`,
    },
  ]);
}

for (const [from, edge] of EDGES) {
  const node = NAV_NODES[from];
  if (!node) continue;
  // Hand-written edges win over the mechanical ones.
  if (node.edges.some((e) => e.to === edge.to)) continue;
  node.edges.push(edge);
}

// ─── Derived structure ──────────────────────────────────────────────────────

/** Children of a node, in declaration order. */
export function childrenOf(id: NodeId): NavNode[] {
  return ALL_NODES.filter((n) => n.parent === id);
}

/** Root → node, inclusive. The full "where am I" trail. */
export function trailTo(id: NodeId): NavNode[] {
  const out: NavNode[] = [];
  let cur: NavNode | undefined = NAV_NODES[id];
  while (cur) {
    out.unshift(cur);
    cur = cur.parent ? NAV_NODES[cur.parent] : undefined;
  }
  return out;
}

/** Edges from a node, split into the two groups the compass footer renders. */
export function edgesFor(id: NodeId): { near: NavEdge[]; far: NavEdge[] } {
  const edges = NAV_NODES[id]?.edges ?? [];
  return {
    near: edges.filter((e) => e.proximity === "near"),
    far: edges.filter((e) => e.proximity === "far"),
  };
}

/**
 * Whether a node's href needs a country to be resolvable. A global → country
 * edge has no iso3 in hand, so the surface following it must send the reader
 * through the country picker rather than guessing one.
 */
export function needsCountry(node: NavNode): boolean {
  return (node.legacyPath ?? node.path).includes(":iso3");
}

/**
 * Concrete href for a node. Content that has not moved to its target `path`
 * yet is still served from `legacyPath`, so that wins while it exists — delete
 * the legacyPath when the route moves and callers need no change.
 * Returns null for nodes with nothing to navigate to.
 */
export function nodePath(node: NavNode, iso3?: string): string | null {
  if (node.status === "planned") return null;
  const template = node.legacyPath ?? node.path;
  return iso3 ? template.replace(":iso3", iso3) : template;
}

/**
 * A lens's guided walkthrough, if it has one.
 *
 * Narratives are destinations, not scope variants: an argument read in order is
 * a different kind of object from a reference panel, and burying one behind a
 * scope toggle means nobody learns it exists. Surfaced as its own entry so it is
 * reachable in one click from anywhere, in either scope.
 */
export function narrativeFor(lens: LensId): NavNode | null {
  const node = NAV_NODES[`global.${lens}`];
  return node?.kind === "narrative" && node.status === "live" ? node : null;
}

/** The same lens in the other scope — the scope switch's destination. */
export function counterpart(node: NavNode): NavNode | null {
  if (!node.lens) return null;
  const other = node.scope === "country" ? "global" : "country";
  return NAV_NODES[`${other}.${node.lens}`] ?? null;
}

// ─── Location resolution ────────────────────────────────────────────────────

function toMatcher(template: string): RegExp {
  const src = template
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:iso3/g, "[^/]+");
  return new RegExp(`^${src}/?$`);
}

interface Matcher {
  re: RegExp;
  id: NodeId;
  /** The node's own path beats a legacy path it shares with its siblings. */
  exact: boolean;
  len: number;
}

// Only live nodes are addressable. Planned nodes (the disease sub-views, the
// empty global cells) must not swallow their parent's route: all four disease
// nodes name the same page today, so registering them would make
// /country/KEN/diseases resolve to whichever sorted first.
const MATCHERS: Matcher[] = ALL_NODES.filter((n) => n.status === "live").flatMap(
  (n) => {
    const out: Matcher[] = [
      { re: toMatcher(n.path), id: n.id, exact: true, len: n.path.length },
    ];
    if (n.legacyPath) {
      out.push({
        re: toMatcher(n.legacyPath),
        id: n.id,
        exact: false,
        len: n.legacyPath.length,
      });
    }
    return out;
  }
);

export interface NavLocation {
  node: NavNode | null;
  trail: NavNode[];
  scope: Scope | null;
  lens: LensId | null;
  iso3: string | null;
}

/** Resolve a pathname to its place in the graph. Handles both the current
 *  routes and the ones content is due to move to. */
export function resolveLocation(pathname: string): NavLocation {
  const clean = pathname.split(/[?#]/)[0];
  // A node's own path beats a legacy path; then longest template wins, so
  // /fiscal/debt beats /fiscal.
  const hit = MATCHERS.filter((m) => m.re.test(clean)).sort(
    (a, b) => Number(b.exact) - Number(a.exact) || b.len - a.len
  )[0];
  const node = hit ? NAV_NODES[hit.id] : null;

  const parts = clean.split("/").filter(Boolean);
  const iso3 =
    parts[0] === "country"
      ? (parts[1]?.toUpperCase() ?? null)
      : parts[0] === "pfm" && parts[1] === "country"
        ? (parts[2]?.toUpperCase() ?? null)
        : null;

  return {
    node,
    trail: node ? trailTo(node.id) : [],
    scope: node?.scope ?? null,
    lens: node?.lens ?? null,
    iso3,
  };
}

// ─── Indicator level (depth 3) ──────────────────────────────────────────────

export interface NavIndicator {
  code: string;
  label: string;
}

function indicatorCodesForPillar(pillar: string): string[] {
  return Object.values(INDICATOR_REGISTRY)
    .filter((i) => i.pillars.includes(pillar))
    .map((i) => i.code);
}

/** Every indicator that appears on a pillar page (honours the overlap set). */
export function navIndicatorsForPillar(pillar: string): NavIndicator[] {
  return Object.values(INDICATOR_REGISTRY)
    .filter((i) => i.pillars.includes(pillar))
    .map((i) => ({ code: i.code, label: i.label }));
}

// ─── Backward-compatible exports ────────────────────────────────────────────
// map-nav.tsx still reads these; they are now views onto the graph above.

export interface NavView {
  seg: string;
  label: string;
  hasChildren: boolean;
}

export const NAV_VIEWS: NavView[] = LENSES.filter((l) => l.id !== "pfm").map(
  (l) => ({
    seg: l.seg,
    label: l.label,
    hasChildren: NAV_NODES[`country.${l.id}`].expands === "route",
  })
);

export interface NavPillar {
  key: string;
  label: string;
}

export const NAV_PILLARS: NavPillar[] = FISCAL_PILLAR_KEYS.map((k) => ({
  key: k,
  label: PILLARS[k as keyof typeof PILLARS],
}));

/** Resolve the active view + pillar from a country pathname. */
export function parseNavLocation(pathname: string): {
  viewSeg: string;
  pillar: string | null;
} {
  const parts = pathname.split("/").filter(Boolean);
  const viewSeg = parts[2] ?? "";
  const pillar = viewSeg === "fiscal" ? (parts[3] ?? null) : null;
  return { viewSeg, pillar };
}
