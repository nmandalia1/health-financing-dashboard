/**
 * The shape of one column in the KPI ledger, shared by the real cell and its
 * loading placeholder so the two cannot drift apart.
 *
 * Because KpiRow gives the band exactly as many columns as it has cells, the
 * last cell in the band is simply `:last-child` — no nth-child arithmetic that
 * breaks when a view passes two or five KPIs instead of four. Below md the band
 * stacks and the rules turn horizontal.
 */
export const KPI_CELL =
  "grid row-span-5 grid-rows-subgrid py-4 border-border/60 " +
  "border-b last:border-b-0 " +
  "md:border-b-0 md:border-r md:last:border-r-0 " +
  "md:px-5 md:first:pl-0 md:last:pr-0";
