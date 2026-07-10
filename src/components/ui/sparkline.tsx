import { cn } from "@/lib/utils";

type Point = readonly [number, number];

/**
 * The filled line trace both {@link Sparkline} and the work bar's HourTrace
 * render: a quiet area under a hairline stroke, drawn from explicit points in a
 * `width × height` viewBox. Fewer than two points shows the resting bar. Callers
 * own how points map from their data (index vs wall-clock x, fixed vs windowed
 * y) — this owns the SVG so the drawing lives once.
 */
export function Trace({
  points,
  width = 100,
  height,
  className,
}: {
  points: readonly Point[];
  width?: number;
  height: number;
  /** Rendered height utility (e.g. `h-6`); also sizes the resting bar. */
  className?: string;
}) {
  if (points.length < 2) {
    return <div className={cn("w-full rounded-[4px] bg-ink-800/50", className)} />;
  }
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${points[0][0].toFixed(1)},${height} ${line} ${points[points.length - 1][0].toFixed(1)},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      aria-hidden
    >
      <polygon points={area} className="fill-ink-800" />
      <polyline
        points={line}
        fill="none"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-ink-400"
      />
    </svg>
  );
}

/**
 * Tiny rolling history graph. Values are 0..max; the newest sample sits at
 * the right edge and the trace grows leftwards until `capacity` is reached.
 */
export function Sparkline({
  values,
  capacity,
  max = 100,
  className,
}: {
  values: number[];
  capacity: number;
  max?: number;
  className?: string;
}) {
  const h = 24;
  const step = 100 / (capacity - 1);
  const offset = capacity - values.length;
  const points = values.map((v, i) => {
    const x = (offset + i) * step;
    const clamped = Math.min(max, Math.max(0, v));
    // Inset 1px top/bottom so the stroke isn't clipped at the extremes.
    const y = h - 1 - (clamped / max) * (h - 2);
    return [x, y] as const;
  });
  return <Trace points={points} height={h} className={cn("h-6", className)} />;
}

/**
 * A {@link Sparkline} over a complete daily series: the whole array is the
 * window, and the scale runs from zero to the largest value (never below 1, so a
 * run of zero days sits flat on the floor instead of dividing by zero).
 *
 * The four revenue surfaces each open-coded exactly this. Renders nothing for a
 * single point — one day is not a trend.
 */
export function SparkTrace({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  return (
    <Sparkline
      values={values}
      capacity={values.length}
      max={Math.max(...values, 1)}
      className={className}
    />
  );
}
