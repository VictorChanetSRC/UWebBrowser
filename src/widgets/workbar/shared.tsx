import type { ReactNode } from "react";
import type { Game } from "@/lib/config";
import { sourceError } from "@/lib/format";
import { WidgetHint as SharedWidgetHint, TracksGameChips } from "../shared";
import type { BarEditorProps, BarWidgetBase } from "./define";

/**
 * The building blocks work bar widget bodies are made of. Bodies render at
 * the rail's 220px width, so keep rows tight and let text truncate.
 */

// Shared with the dashboard: placeholder-row stack and the labelled chip row.
export { RowSkeletons, ChipRow } from "../shared";

/** The card shell every rail widget sits in; pass onClick to make it a link. */
export function WidgetCard({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const base = "flex w-full flex-col gap-2 rounded-[10px] border border-border bg-ink-900 p-3";
  if (!onClick) return <div className={base}>{children}</div>;
  return (
    <button
      className={`${base} text-left transition-[border-color,background-color] duration-[130ms] ease-brand hover:border-ink-700 hover:bg-ink-800`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

/** A quiet one-liner for empty and not-set-up-yet states, at the rail's size. */
export function WidgetHint({ children }: { children: ReactNode }) {
  return <SharedWidgetHint size="bar">{children}</SharedWidgetHint>;
}

/**
 * The gate every Steam rail widget opens with. The dashboard has `DataCard` to
 * decide loading/error/empty precedence; the rail widgets used to each hand-roll
 * the same four branches, so the order — and the retry copy — could drift.
 *
 * Precedence: no game → no app id → still loading → the source failed → content.
 */
export function SteamState<D>({
  game,
  appid,
  data,
  error,
  noGame,
  skeleton,
  children,
}: {
  game: Game | null;
  appid: string;
  data: D | null | undefined;
  error: unknown;
  /** Why this widget needs a game, in its own words. */
  noGame: ReactNode;
  skeleton: ReactNode;
  /** Rendered only once the data is in, so callers get it non-null. */
  children: (data: D, game: Game) => ReactNode;
}) {
  if (!game) return <WidgetHint>{noGame}</WidgetHint>;
  if (!appid) {
    return <WidgetHint>{game.name || "This game"} has no Steam App ID yet.</WidgetHint>;
  }
  if (!data && !error) return <>{skeleton}</>;
  if (!data) return <WidgetHint>Steam didn't answer. Retrying shortly.</WidgetHint>;
  return <>{children(data, game)}</>;
}

/**
 * {@link SteamState}'s sibling for rail widgets gated on an API key rather than
 * a game — the itch ones. Same precedence, same retry copy, and it wraps its own
 * `WidgetCard` so only the content branch (which is usually a *clickable* card)
 * is the caller's business.
 *
 * Precedence: no key → the source failed → still loading → content.
 */
export function KeyedState<D>({
  hasKey,
  noKey,
  source,
  data,
  error,
  skeleton,
  children,
}: {
  hasKey: boolean;
  /** Why this widget needs a key, in its own words. */
  noKey: ReactNode;
  /** Named in the failure line, e.g. "itch.io". */
  source: string;
  data: D | null | undefined;
  error: unknown;
  skeleton: ReactNode;
  /** Rendered only once the data is in, so callers get it non-null. */
  children: (data: D) => ReactNode;
}) {
  if (!hasKey) {
    return (
      <WidgetCard>
        <WidgetHint>{noKey}</WidgetHint>
      </WidgetCard>
    );
  }
  if (!data && error) {
    return (
      <WidgetCard>
        <WidgetHint>{sourceError(source, error)}</WidgetHint>
      </WidgetCard>
    );
  }
  if (!data) return <WidgetCard>{skeleton}</WidgetCard>;
  return <>{children(data)}</>;
}

/** Row editor for widgets that track one setup game via a `gameId` field;
 *  hidden until there's a real choice to make. Adds the work bar page's top
 *  hairline around the shared chip picker. */
export function TracksGameEditor<W extends BarWidgetBase & { gameId: string | null }>({
  widget,
  games,
  onPatch,
}: BarEditorProps<W>) {
  return (
    <TracksGameChips
      widget={widget}
      games={games}
      onPatch={onPatch}
      className="border-t border-border p-2.5 pl-3.5"
    />
  );
}
