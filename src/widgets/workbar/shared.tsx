import type { ReactNode } from "react";
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
