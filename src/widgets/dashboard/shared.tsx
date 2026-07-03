import type { ReactNode } from "react";
import type { Game } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LiveDot } from "@/components/ui/live-dot";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashConfigProps, DashWidgetBase } from "./define";

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
 */
export function DataCard({
  label,
  links,
  error,
  loading,
  skeleton,
  children,
}: {
  label: ReactNode;
  links?: ReactNode;
  error?: string | null | false;
  loading?: boolean;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="h-full min-w-0 overflow-hidden rounded-[18px]">
      <CardHeader className="flex-none">
        <Label>{label}</Label>
        {links && <div className="flex gap-4">{links}</div>}
      </CardHeader>
      <div className="-mr-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-3">
        {error ? <p className="text-ink-400">{error}</p> : loading ? skeleton : children}
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

export function RowSkeletons({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("h-11 rounded-lg", className)} />
      ))}
    </div>
  );
}

/** A quiet one-liner for empty and not-set-up-yet states. */
export function TileHint({ children }: { children: ReactNode }) {
  return <p className="text-ink-400">{children}</p>;
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
      <span className="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap text-[22px] font-semibold tabular-nums tracking-[-0.02em]">
        {live && <LiveDot className={muted ? "bg-ink-400" : undefined} />}
        {value}
      </span>
      <Label className="text-[10px]">{label}</Label>
    </div>
  );
}

/** The game a widget tracks: its pick, or the first game on the setup. */
export function trackedGame(gameId: string | null, games: Game[]): Game | null {
  return games.find((g) => g.id === gameId) ?? games[0] ?? null;
}

/* ------------------------------ config strips ------------------------------ */

/**
 * The frame for a tile's Customize-mode settings: a floating strip pinned to
 * the tile's bottom edge. A widget's Config component wraps its rows in this
 * (and returns null when there's nothing to choose).
 */
export function ConfigStrip({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-2 bottom-2 rounded-[10px] border border-border bg-ink-900/95 shadow-[0_10px_28px_rgba(0,0,0,0.4)] backdrop-blur">
      {children}
    </div>
  );
}

/** One labelled row of exclusive chips inside a {@link ConfigStrip}. */
export function ChipRow({
  label,
  options,
  selected,
  onPick,
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: string | null;
  onPick: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 pl-2.5">
      <Label className="mr-1 text-[10px]">{label}</Label>
      {options.map((option) => (
        <Button
          key={option.key}
          variant="chip"
          size="chip"
          className="h-[24px] px-2.5 text-[11px]"
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
 * The shared Config for widgets that track one of your games (game, buzz,
 * build). Shows nothing until there's actually a choice to make.
 */
export function TracksGameConfig<W extends DashWidgetBase & { gameId: string | null }>({
  widget,
  games,
  onPatch,
}: DashConfigProps<W>) {
  if (games.length < 2) return null;
  return (
    <ConfigStrip>
      <ChipRow
        label="Tracks"
        options={games.map((g) => ({ key: g.id, label: g.name || "Untitled" }))}
        selected={(games.find((g) => g.id === widget.gameId) ?? games[0])?.id ?? null}
        // The key is a real game id; TS just can't see that through the generic.
        onPick={(gameId) => onPatch({ gameId } as Partial<W>)}
      />
    </ConfigStrip>
  );
}
