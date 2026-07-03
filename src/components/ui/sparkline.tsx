import { cn } from "@/lib/utils";

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
  const w = 100;
  const h = 24;

  if (values.length < 2) {
    return <div className={cn("h-6 w-full rounded-[4px] bg-ink-800/50", className)} />;
  }

  const step = w / (capacity - 1);
  const offset = capacity - values.length;
  const points = values.map((v, i) => {
    const x = (offset + i) * step;
    const clamped = Math.min(max, Math.max(0, v));
    // Inset 1px top/bottom so the stroke isn't clipped at the extremes.
    const y = h - 1 - (clamped / max) * (h - 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${points[0][0].toFixed(1)},${h} ${line} ${points[points.length - 1][0].toFixed(1)},${h}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-6 w-full", className)}
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
