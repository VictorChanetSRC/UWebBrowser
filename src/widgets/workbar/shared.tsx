import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trackedGame } from "../types";
import type { BarEditorProps, BarWidgetBase } from "./define";

/**
 * The building blocks work bar widget bodies are made of. Bodies render at
 * the rail's 220px width, so keep rows tight and let text truncate.
 */

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

/** A quiet one-liner for empty and not-set-up-yet states. */
export function WidgetHint({ children }: { children: ReactNode }) {
  return <p className="px-0.5 text-[12px] leading-[1.5] text-ink-400">{children}</p>;
}

/** Row editor for widgets that track one setup game via a `gameId` field;
 *  hidden until there's a real choice to make. */
export function TracksGameEditor<W extends BarWidgetBase & { gameId: string | null }>({
  widget,
  games,
  onPatch,
}: BarEditorProps<W>) {
  if (games.length < 2) return null;
  const selected = trackedGame(widget.gameId, games);
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border p-2.5 pl-3.5">
      <Label className="mr-1 text-[10px]">Tracks</Label>
      {games.map((game) => (
        <Button
          key={game.id}
          variant="chip"
          size="chip"
          className="h-[24px] px-2.5 text-[11px]"
          aria-pressed={game.id === selected?.id}
          onClick={() => onPatch({ gameId: game.id } as Partial<W>)}
        >
          {game.name || "Untitled"}
        </Button>
      ))}
    </div>
  );
}
