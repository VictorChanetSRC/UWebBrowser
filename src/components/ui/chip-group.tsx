import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/**
 * A row of mutually-exclusive chips. The `chip` button variant was already
 * shared; this wraps the map + `aria-pressed` wiring that the history ranges,
 * the settings search engines and the feedback kinds each repeated around it.
 *
 * Discover's category chips deliberately stay hand-rolled: they carry an "All"
 * pseudo-option and toggle off when re-picked, which this doesn't model.
 */
export function ChipGroup<T extends string>({
  options,
  value,
  onPick,
  className,
  children,
}: {
  options: readonly { key: T; label: string; icon?: ReactNode }[];
  value: T | null;
  onPick: (key: T) => void;
  className?: string;
  /** Trailing content in the same row, e.g. a result count. */
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {options.map((option) => (
        <Button
          key={option.key}
          variant="chip"
          size="chip"
          aria-pressed={value === option.key}
          onClick={() => onPick(option.key)}
        >
          {option.icon}
          {option.label}
        </Button>
      ))}
      {children}
    </div>
  );
}
