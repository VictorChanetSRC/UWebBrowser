import { useEffect, useRef, type ReactNode } from "react";
import { DismissLayer } from "@/components/ui/dismiss-layer";
import { POPOVER_SURFACE, Z_POPOVER } from "@/components/ui/overlay";
import { useEscape } from "@/hooks/use-escape";
import { cn } from "@/lib/utils";

export type MenuItem = {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Draws a hairline above this item, grouping what follows. */
  separated?: boolean;
};

/**
 * A right-click menu, anchored at a point.
 *
 * Every menu in the app goes through this, because the parts that are easy to
 * forget are the parts that matter: it takes focus when it opens, moves focus
 * with the arrow keys, closes on Escape or a click outside, and hands focus back
 * to whatever opened it. A menu reachable only by mouse is a feature keyboard
 * users don't have.
 *
 * Callers are responsible for *opening* it from both `onContextMenu` and the
 * keyboard's ContextMenu / Shift+F10 keys.
 */
export function ContextMenu({
  label,
  x,
  y,
  items,
  onDismiss,
}: {
  /** Names the menu for assistive tech, e.g. "uBlock Origin options". */
  label: string;
  x: number;
  y: number;
  items: MenuItem[];
  /** Called for Escape, click-away, and after any item is chosen. Restore focus
   *  to the trigger here. */
  onDismiss: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEscape(onDismiss);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, []);

  const step = (from: HTMLElement, dir: 1 | -1) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [],
    );
    const index = buttons.indexOf(from as HTMLButtonElement);
    buttons[(index + dir + buttons.length) % buttons.length]?.focus();
  };

  return (
    <>
      <DismissLayer onDismiss={onDismiss} />
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        className={cn(
          POPOVER_SURFACE,
          // A context menu is a tighter surface than a page dropdown.
          "fixed min-w-44 overflow-hidden rounded-md py-1",
          Z_POPOVER,
        )}
        style={{ left: x, top: y }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            step(e.target as HTMLElement, e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {items.map((item, index) => (
          <button
            key={index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onDismiss();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-200 transition-colors duration-[130ms] ease-brand hover:bg-ink-800 disabled:cursor-default disabled:text-ink-600 disabled:hover:bg-transparent",
              item.separated && "mt-1 border-t border-ink-800 pt-2",
            )}
          >
            {item.icon && (
              <span className="flex-none text-ink-400 [&_svg]:size-3.5">{item.icon}</span>
            )}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
