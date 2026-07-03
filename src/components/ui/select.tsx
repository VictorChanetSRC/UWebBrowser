import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export type SelectOption = { value: string; label: string };

/**
 * A compact select styled end to end — unlike a native `<select>`, whose open
 * popup is OS-default white and breaks the Ink UI. Closed trigger matches the
 * old inline select; the open list is a styled Ink popover with keyboard
 * support (arrows, Enter, Escape, type-to-open) and listbox semantics.
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open, selectedIndex]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(active);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative flex-none", className)}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="flex h-7 w-full items-center gap-1.5 rounded-md border border-border bg-ink-900 px-1.5 text-xs text-ink-300 outline-none transition-[border-color] duration-[130ms] ease-brand hover:border-ink-600 focus-visible:border-ink-400"
      >
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
          {selected?.label ?? options[0]?.label ?? ""}
        </span>
        <ChevronDown
          className={cn(
            "size-3 flex-none text-ink-500 transition-transform duration-[130ms] ease-brand",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute right-0 top-[calc(100%+4px)] z-50 max-h-56 min-w-full overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-[0_18px_44px_rgba(0,0,0,0.55)]"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(index);
              }}
              className={cn(
                "cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-[5px] px-2 py-1.5 text-xs",
                index === active ? "bg-ink-800 text-ink-100" : "text-ink-300",
                option.value === value && "font-medium",
              )}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
