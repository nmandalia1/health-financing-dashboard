import { Children, type CSSProperties, type ReactNode } from "react";

/**
 * The row owns the grid; the cells inherit it.
 *
 * This is the change that fixes the ragged look: previously each card stacked
 * its own contents, so a label wrapping to three lines pushed that card's value
 * below its neighbours'. Declaring the tracks here and having every cell adopt
 * them with `grid-rows-subgrid` puts labels, figures, deltas and traces on
 * shared lines across the whole row, whatever the labels do.
 *
 * The column count follows the number of cells rather than being fixed at four.
 * As a ruled band this matters in a way it didn't as separate cards: two cards
 * in a four-column grid left half the band visibly empty. One band, one row of
 * cells — which also means "last in the band" is just `:last-child`, and the
 * dividers need no positional arithmetic.
 */
export function KpiRow({ children }: { children: ReactNode }) {
  const count = Children.count(children);

  return (
    <div
      className="grid grid-cols-1 border-y border-border [grid-template-rows:repeat(30,auto)] md:[grid-template-columns:repeat(var(--kpi-cols),minmax(0,1fr))] md:[grid-template-rows:repeat(5,auto)]"
      style={{ "--kpi-cols": Math.min(count, 6) } as CSSProperties}
    >
      {children}
    </div>
  );
}
