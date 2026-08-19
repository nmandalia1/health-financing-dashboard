"use client";

import Link from "next/link";
import { useFiscalComposites } from "@/hooks/use-fiscal-composites";
import { FISCAL_PILLAR_KEYS } from "@/lib/queries";
import { PILLARS } from "@/lib/indicator-registry";
import { bandColor, scoreVerdict } from "@/lib/fiscal-scoring";
import { InfoTooltip } from "@/components/ui/info-tooltip";

// Semicircle gauge: centre (90,100), r=70. Angle 180°→0° maps score 0→100.
function polar(angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [90 + 70 * Math.cos(a), 100 - 70 * Math.sin(a)];
}
function arcPath(score: number): string {
  const [sx, sy] = polar(180);
  const [ex, ey] = polar(180 - (Math.max(0, Math.min(100, score)) / 100) * 180);
  return `M ${sx.toFixed(1)} ${sy.toFixed(1)} A 70 70 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

export function FiscalVerdict({ iso3 }: { iso3: string }) {
  const { latest, peerMedians, incomeGroup, available, isLoading } =
    useFiscalComposites(iso3);

  if (isLoading) {
    return <div className="h-56 animate-pulse rounded-lg border bg-muted" />;
  }
  // Graceful: no mart / no published index → render nothing (page still works).
  if (!available || !latest || latest.fsh_index == null) return null;

  const index = Math.round(latest.fsh_index);
  const { label, tone } = scoreVerdict(index);
  const peerIndex = peerMedians?.fsh_index ?? null;

  // Pillar scores present, for verdict-sentence extremes.
  const present = FISCAL_PILLAR_KEYS.map((k) => ({
    key: k,
    label: PILLARS[k as keyof typeof PILLARS],
    score: latest[`pillar_${k}_score`],
    peer: peerMedians?.[`pillar_${k}_score`] ?? null,
  })).filter((p) => p.score != null) as Array<{
    key: string;
    label: string;
    score: number;
    peer: number | null;
  }>;

  const weakest = present.reduce((a, b) => (b.score < a.score ? b : a), present[0]);
  const strongest = present.reduce((a, b) => (b.score > a.score ? b : a), present[0]);
  const nPillars = present.length;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5">
          <h2 className="text-sm font-medium text-muted-foreground">
            Fiscal Space for Health Index — verdict
          </h2>
          <InfoTooltip
            title="Fiscal Space for Health Index"
            description="A 0–100 composite across seven pillars. Each pillar is scored relative to income-group peers, then combined so a very weak pillar lowers the overall score."
            source="Composite of WHO GHED, IMF WEO, World Bank, WGI/CPIA, PEFA"
            interpretation="Read the index as a structured signal, not a causal estimate. The pillar breakdown shows what is driving the score."
            referenceUrl="https://apps.who.int/nha/database"
          />
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground/70">
          {latest.year} · {nPillars}/7 pillars
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        {/* Gauge + verdict */}
        <div className="flex flex-col items-center justify-center text-center">
          <svg viewBox="0 0 180 116" width="180" height="116" role="img"
               aria-label={`Index ${index} out of 100`}>
            <path d={arcPath(100)} fill="none" stroke="currentColor"
                  className="text-muted/40" strokeWidth="13" strokeLinecap="round" />
            <path d={arcPath(index)} fill="none" stroke={bandColor(index)}
                  strokeWidth="13" strokeLinecap="round" />
            <text x="90" y="92" textAnchor="middle"
                  className="fill-foreground" style={{ fontSize: 30, fontWeight: 500 }}>
              {index}
            </text>
            <text x="90" y="108" textAnchor="middle"
                  className="fill-muted-foreground" style={{ fontSize: 11 }}>
              / 100
            </text>
          </svg>
          <span className={`text-sm font-medium ${tone}`}>{label}</span>
          {peerIndex != null && (
            <span className="mt-1 text-[11px] text-muted-foreground">
              peer median {Math.round(peerIndex)} ({incomeGroup})
            </span>
          )}
        </div>

        {/* Pillar breakdown */}
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Seven pillars, scored 0–100 vs {incomeGroup ?? "peers"} · tick = peer median ·{" "}
            <span className="text-muted-foreground/70">click a pillar to drill in</span>
          </p>
          <div className="space-y-1">
            {FISCAL_PILLAR_KEYS.map((k) => {
              const score = latest[`pillar_${k}_score`];
              const peer = peerMedians?.[`pillar_${k}_score`] ?? null;
              return (
                <Link
                  key={k}
                  href={`/country/${iso3}/fiscal/${k}`}
                  className="flex items-center gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-muted/60"
                >
                  <span className="w-32 shrink-0 truncate text-xs text-muted-foreground"
                        title={PILLARS[k as keyof typeof PILLARS]}>
                    {PILLARS[k as keyof typeof PILLARS]}
                  </span>
                  <div className="relative h-2.5 flex-1 rounded-full bg-muted">
                    {score != null && (
                      <div className="absolute left-0 top-0 h-2.5 rounded-full"
                           style={{ width: `${score}%`, background: bandColor(score) }} />
                    )}
                    {peer != null && (
                      <div className="absolute -top-0.5 h-3.5 w-0.5 bg-foreground/55"
                           style={{ left: `${peer}%` }} aria-hidden />
                    )}
                  </div>
                  <span className="w-7 shrink-0 text-right text-xs font-medium tabular-nums">
                    {score != null ? Math.round(score) : "—"}
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Read:</span> fiscal space is{" "}
            {label.toLowerCase()}. The tightest constraint is{" "}
            <span className="font-medium">{weakest.label.toLowerCase()}</span> ({Math.round(weakest.score)}); the
            strongest is{" "}
            <span className="font-medium">{strongest.label.toLowerCase()}</span> ({Math.round(strongest.score)}).
          </p>
        </div>
      </div>
    </div>
  );
}
