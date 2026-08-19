import { Sparkles } from "lucide-react";

interface InsightPanelProps {
  sentences: string[];
}

/**
 * Auto-generated narrative summary of a country's financing profile.
 * Renders nothing if we couldn't derive at least one sentence — better to
 * stay silent than fill the card with filler.
 */
export function InsightPanel({ sentences }: InsightPanelProps) {
  if (sentences.length === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-foreground/10 bg-gradient-to-br from-violet-50/60 via-card to-blue-50/40 p-4 shadow-sm dark:from-violet-950/30 dark:via-card dark:to-blue-950/20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 ring-1 ring-violet-200/80 dark:bg-violet-900/40 dark:text-violet-300 dark:ring-violet-800/60">
          <Sparkles className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              At a glance
            </h3>
            <span className="text-[10px] text-muted-foreground/70">
              auto-generated
            </span>
          </div>
          <ul className="space-y-1.5 text-sm leading-relaxed text-foreground/90">
            {sentences.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-violet-500/70 dark:bg-violet-400/80"
                  aria-hidden
                />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
