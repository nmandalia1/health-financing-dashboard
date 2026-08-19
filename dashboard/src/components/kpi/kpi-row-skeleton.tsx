import { KpiRow } from "./kpi-row";
import { KPI_CELL } from "./kpi-cell";

/**
 * The loading state of a KPI band.
 *
 * It renders through KpiRow with the same cell class as the real thing, so the
 * band chrome, column rules and row tracks are identical and the layout does
 * not jump when the data lands — previously the skeleton drew four rounded
 * cards and then flashed into a ruled band.
 */
export function KpiRowSkeleton({
  count = 4,
  /** Reserve the trace and period rows, for bands whose cells pass a series. */
  trace = false,
}: {
  count?: number;
  trace?: boolean;
}) {
  // Heights match the real rows' line boxes so the band does not resize when
  // the data lands.
  const bar = "animate-pulse rounded bg-muted";

  return (
    <KpiRow>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={KPI_CELL} aria-hidden>
          {/* name */}
          <div className="min-h-[30px] self-start">
            <div className={`h-[15px] w-2/3 ${bar}`} />
          </div>
          {/* figure */}
          <div className="self-end pt-3">
            <div className={`h-[34px] w-1/2 ${bar}`} />
          </div>
          {/* change */}
          <div className="self-end pt-2">
            <div className={`h-[16px] w-2/5 ${bar}`} />
          </div>
          {trace && (
            <div className="self-end pt-3.5">
              <div className={`h-[36px] w-full ${bar}`} />
            </div>
          )}
          {trace && (
            <div className="flex justify-between self-end pt-1.5">
              <div className={`h-[14px] w-7 ${bar}`} />
              <div className={`h-[14px] w-7 ${bar}`} />
            </div>
          )}
        </div>
      ))}
    </KpiRow>
  );
}
