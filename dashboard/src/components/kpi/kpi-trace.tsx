import type { IndicatorTimeSeries } from "@/lib/types";

/**
 * The trace row of a KPI cell — a full-bleed history of the figure above it.
 *
 * Inline SVG rather than the Plotly `Sparkline`: at 36px tall, in a row of four,
 * a chart library is all cost and no benefit, and this needs two things Plotly
 * will not give here — geometry that stretches to whatever width the column
 * happens to be, with a stroke that stays 1.5px, and an endpoint marker that
 * does not stretch with it.
 *
 * Colour comes from `currentColor`, so a cell tints its trace by wrapping it;
 * an untinted cell inherits the muted foreground and stays neutral.
 */

const W = 240;
const H = 36;
const PAD_X = 3;
const PAD_Y = 4;

export function KpiTrace({
  data,
  label,
}: {
  data: IndicatorTimeSeries[];
  /** Describes the trend for screen readers. */
  label: string;
}) {
  if (data.length < 2) return null;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; draw it down the middle instead.
  const span = max - min;
  const stepX = (W - PAD_X * 2) / (data.length - 1);

  const points = data.map((d, i) => {
    const x = PAD_X + i * stepX;
    const y =
      span === 0
        ? H / 2
        : PAD_Y + (1 - (d.value - min) / span) * (H - PAD_Y * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} ${(W - PAD_X).toFixed(1)},${H} ${PAD_X},${H}`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <div className="relative" style={{ height: H }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-full w-full"
        role="img"
        aria-label={label}
      >
        <polygon points={area} fill="currentColor" fillOpacity={0.09} />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.72}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          // Keeps the stroke even after the non-uniform stretch above.
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* A circle would stretch to an ellipse under preserveAspectRatio="none",
          so the endpoint is positioned in layout rather than drawn in the SVG. */}
      <span
        aria-hidden
        className="absolute h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
        style={{ left: `${(lastX / W) * 100}%`, top: `${(lastY / H) * 100}%` }}
      />
    </div>
  );
}
