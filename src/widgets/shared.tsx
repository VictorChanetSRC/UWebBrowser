import type { ReactNode } from "react";
import type { Game } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { trackedGame } from "./types";

/**
 * The widget building blocks shared by BOTH surfaces (dashboard tiles and work
 * bar rail widgets). Each surface's own shared.tsx re-exports these with its
 * sizing so widget files keep a single local import, and the markup lives once.
 */

/** A quiet one-liner for empty and not-set-up-yet states. `size="bar"` is the
 *  tighter rail treatment; `"tile"` is the roomier board one. */
export function WidgetHint({
  children,
  size = "tile",
}: {
  children: ReactNode;
  size?: "tile" | "bar";
}) {
  return (
    <p className={cn("text-ink-400", size === "bar" && "px-0.5 text-[12px] leading-[1.5]")}>
      {children}
    </p>
  );
}

/** A stack of placeholder rows for the loading state of a list widget. */
export function RowSkeletons({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("h-11 rounded-lg", className)} />
      ))}
    </div>
  );
}

/** One labelled row of exclusive chips. `className` overrides the container so a
 *  caller can add a hairline or reflow the padding. */
export function ChipRow({
  label,
  options,
  selected,
  onPick,
  className,
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: string | null;
  onPick: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 p-2 pl-2.5", className)}>
      <Label size="micro" className="mr-1">{label}</Label>
      {options.map((option) => (
        <Button
          key={option.key}
          variant="chip"
          size="chip"
          className="h-6 px-2.5 text-[11px]"
          aria-pressed={option.key === selected}
          onClick={() => onPick(option.key)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The "which of your games does this widget track" chip row, shared by every
 * game-tracking widget on both surfaces. Renders nothing until there's an
 * actual choice to make. Each surface passes the `className` its frame wants
 * (the dashboard wraps this in a ConfigStrip; the work bar adds a top hairline).
 */
export function TracksGameChips<W extends { gameId: string | null }>({
  widget,
  games,
  onPatch,
  className,
}: {
  widget: W;
  games: Game[];
  onPatch: (patch: Partial<W>) => void;
  className?: string;
}) {
  if (games.length < 2) return null;
  const selected = trackedGame(widget.gameId, games);
  return (
    <ChipRow
      className={className}
      label="Tracks"
      options={games.map((g) => ({ key: g.id, label: g.name || "Untitled" }))}
      selected={selected?.id ?? null}
      // The key is a real game id; TS just can't see that through the generic.
      onPick={(gameId) => onPatch({ gameId } as Partial<W>)}
    />
  );
}
