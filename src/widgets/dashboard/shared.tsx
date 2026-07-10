import type { ReactNode } from "react";
import { sourceError } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LiveDot } from "@/components/ui/live-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { TracksGameChips } from "../shared";
import type { DashConfigProps, DashWidgetBase } from "./define";

// Shared helpers re-exported so dashboard widgets keep one local import point.
export { trackedAppId, trackedGame } from "../types";
export { RowSkeletons, ChipRow, ShareChips } from "../shared";
// The dashboard's empty-state one-liner is the roomier "tile" size of WidgetHint.
export { WidgetHint as TileHint } from "../shared";

/**
 * The building blocks dashboard widget bodies are made of. Compose these and
 * a tile automatically reads like the rest of the board: mono kicker, quiet
 * links, skeleton-then-content, overflow scrolling inside the card.
 */

/**
 * Shared shell for every tile: mono kicker, quiet links on the right, then
 * error / skeleton / content in that order of precedence. Tiles live on a
 * fixed bento rhythm, so overflow scrolls inside the card instead of
 * stretching the row.
 *
 * The card owns one rule that every tile used to restate: **a fetch failure is
 * only worth showing before the first data lands.** Once a tile has content, a
 * failed refresh must leave it standing rather than blanking it — `usePolled`
 * keeps the last good value for exactly that reason. Pass the raw `error` and
 * the `source` it came from; the card decides.
 */
export function DataCard({
  label,
  links,
  source,
  error,
  loading,
  skeleton,
  children,
}: {
  label: ReactNode;
  links?: ReactNode;
  /** Named in the failure line, e.g. "Steam". Required to render an `error`. */
  source?: string;
  /** Whatever the fetch rejected with; shown only while `loading`. */
  error?: unknown;
  /** True until the tile has data of its own to show. */
  loading?: boolean;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  const failure = loading && source && error != null ? sourceError(source, error) : null;
  return (
    <Card className="h-full min-w-0 overflow-hidden rounded-[18px]">
      <CardHeader className="flex-none">
        <Label>{label}</Label>
        {links && <div className="flex gap-4">{links}</div>}
      </CardHeader>
      <div className="-mr-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-3">
        {failure ? (
          <p className="text-ink-400">{failure}</p>
        ) : loading ? (
          skeleton
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/** A quiet header link on a {@link DataCard}. */
export function CardLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="link" size="none" className="text-[13px] font-normal" onClick={onClick}>
      {children}
    </Button>
  );
}

/** The list wrapper the feed-style tiles put their {@link FeedRow}s in. */
export function FeedList({ children }: { children: ReactNode }) {
  return <ul className="flex list-none flex-col">{children}</ul>;
}

/** Row shell shared by the feed-style tiles: full-width button, hairlines. */
export function FeedRow({
  index,
  onClick,
  className,
  children,
}: {
  index: number;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        className={cn(
          "flex w-full min-w-0 rounded-lg px-2 py-2.5 text-left transition-[background-color] duration-[130ms] ease-brand hover:bg-ink-800",
          index > 0 && "rounded-t-none border-t border-border",
          className,
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </li>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">{children}</div>
  );
}

/** The loading state of a {@link StatGrid}: `count` tiles at a real Stat's
 *  height, so the card doesn't jump when the data lands. */
export function StatGridSkeleton({ count }: { count: number }) {
  return (
    <StatGrid>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[78px]" />
      ))}
    </StatGrid>
  );
}

export function Stat({
  label,
  value,
  live,
  muted,
}: {
  label: string;
  value: string;
  live?: boolean;
  /** Drop the dot to Ink when a Signal element elsewhere owns the screen. */
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-background p-3.5">
      <span className="flex items-center gap-2 truncate text-[22px] font-semibold tabular-nums tracking-[-0.02em]">
        {live && <LiveDot className={muted ? "bg-ink-400" : undefined} />}
        {value}
      </span>
      <Label size="micro">{label}</Label>
    </div>
  );
}

/* ------------------------------ config strips ------------------------------ */

/**
 * The frame for a tile's Customize-mode settings: a floating strip pinned to
 * the tile's bottom edge. A widget's Config component wraps its rows in this
 * (and returns null when there's nothing to choose).
 */
export function ConfigStrip({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-2 bottom-2 rounded-[10px] border border-border bg-ink-900/95 shadow-strip backdrop-blur">
      {children}
    </div>
  );
}

/**
 * The Config for widgets that track one of your games (game, buzz, build):
 * the shared chip picker inside the tile's floating config strip. Shows nothing
 * until there's actually a choice to make.
 */
export function TracksGameConfig<W extends DashWidgetBase & { gameId: string | null }>({
  widget,
  games,
  onPatch,
}: DashConfigProps<W>) {
  if (games.length < 2) return null;
  return (
    <ConfigStrip>
      <TracksGameChips widget={widget} games={games} onPatch={onPatch} />
    </ConfigStrip>
  );
}
