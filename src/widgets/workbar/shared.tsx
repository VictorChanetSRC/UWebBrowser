import type { ReactNode } from "react";

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
