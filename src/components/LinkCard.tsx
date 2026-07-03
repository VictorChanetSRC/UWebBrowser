import type { ReactNode } from "react";
import type { LinkItem } from "../lib/engines";
import { Favicon } from "@/components/ui/favicon";
import { cn } from "@/lib/utils";

type Props = {
  item: LinkItem;
  onOpen: (url: string) => void;
  /** Overlay control (e.g. Discover's pin button), revealed on hover. */
  action?: ReactNode;
  className?: string;
};

export function LinkCard({ item, onOpen, action, className }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.url)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(item.url);
        else if (e.key === " ") {
          e.preventDefault();
          onOpen(item.url);
        }
      }}
      className={cn(
        "group relative grid grid-cols-[18px_1fr] grid-rows-[auto_auto] items-center gap-x-2.5 gap-y-[3px] rounded-[10px] border border-border bg-card p-3.5 text-left transition-[background-color,border-color,transform] duration-[130ms] ease-brand hover:-translate-y-px hover:border-ink-600 hover:bg-ink-800 active:translate-y-0",
        className,
      )}
    >
      <Favicon url={item.url} className="row-start-1 size-4 rounded" />
      <span className={cn("text-sm font-medium text-ink-100", action && "pr-[72px]")}>
        {item.name}
      </span>
      {item.hint && <span className="col-start-2 text-xs text-ink-500">{item.hint}</span>}
      {action}
    </div>
  );
}

export function LinkGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">{children}</div>
  );
}
