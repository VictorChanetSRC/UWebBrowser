import { useState } from "react";
import { discoverCatalog } from "../lib/discover";
import type { LinkItem } from "../lib/engines";
import { LinkCard, LinkGrid } from "./LinkCard";
import { SearchField } from "./SearchField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

type Props = {
  pinnedUrls: Set<string>;
  onOpen: (url: string) => void;
  onTogglePin: (item: LinkItem) => void;
};

export function Discover({ pinnedUrls, onOpen, onTogglePin }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  // Match counts per category ignore the category filter, so the rail keeps
  // showing where else the search hits while one category is selected.
  const matches = discoverCatalog.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        !q ||
        `${item.name} ${item.hint ?? ""} ${group.category}`.toLowerCase().includes(q),
    ),
  }));
  const total = matches.reduce((sum, group) => sum + group.items.length, 0);
  const groups = matches.filter(
    (group) => group.items.length > 0 && (!category || group.category === category),
  );

  const pick = (next: string | null) =>
    setCategory(next !== null && category === next ? null : next);

  return (
    <div className="absolute inset-0 @container overflow-y-auto">
      <div className="mx-auto flex max-w-[1460px] animate-rise flex-col gap-9 px-10 pb-20 pt-14">
        <header>
          <Label>Discover</Label>
          <h1 className="my-2.5 text-[40px] font-semibold leading-[1.1] tracking-[-0.025em]">
            The Unreal dev toolbox.
          </h1>
          <p className="text-ink-400">
            Curated tools, assets, learning and communities for Unreal Engine developers.
            Pin anything to your work bar.
          </p>
        </header>

        {/* Wide windows trade the chip row for a sticky category rail. */}
        <div className="grid gap-x-12 gap-y-9 @4xl:grid-cols-[220px_minmax(0,1fr)] @4xl:items-start">
          <nav
            className="hidden @4xl:flex @4xl:sticky @4xl:top-10 flex-col gap-0.5"
            aria-label="Categories"
          >
            <Label className="px-2.5 pb-2 text-[10.5px]">Browse</Label>
            <RailButton
              name="All"
              count={total}
              active={category === null}
              onClick={() => pick(null)}
            />
            {matches.map((group) => (
              <RailButton
                key={group.category}
                name={group.category}
                count={group.items.length}
                active={category === group.category}
                onClick={() => pick(group.category)}
              />
            ))}
          </nav>

          <div className="flex min-w-0 flex-col gap-9">
            <SearchField
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search tools, assets, channels…"
            />

            <div className="flex flex-wrap gap-2 @4xl:hidden">
              <Button
                variant="chip"
                size="chip"
                aria-pressed={category === null}
                onClick={() => pick(null)}
              >
                All
              </Button>
              {discoverCatalog.map((group) => (
                <Button
                  key={group.category}
                  variant="chip"
                  size="chip"
                  aria-pressed={category === group.category}
                  onClick={() => pick(group.category)}
                >
                  {group.category}
                </Button>
              ))}
            </div>

            {groups.map((group) => (
              <Section label={group.category} key={group.category}>
                <LinkGrid>
                  {group.items.map((item) => (
                    <LinkCard
                      key={item.url}
                      item={item}
                      onOpen={onOpen}
                      action={
                        <PinButton
                          pinned={pinnedUrls.has(item.url)}
                          name={item.name}
                          onToggle={() => onTogglePin(item)}
                        />
                      }
                    />
                  ))}
                </LinkGrid>
              </Section>
            ))}

            {groups.length === 0 && (
              <div className="flex flex-col items-center gap-1 rounded-[10px] border border-dashed border-border px-6 py-14 text-center">
                <p className="text-sm text-ink-300">Nothing matches "{query}".</p>
                <p className="text-[12.5px] text-ink-500">Try another word.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RailButton({
  name,
  count,
  active,
  onClick,
}: {
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] transition-[background-color,color] duration-[130ms] ease-brand",
        active
          ? "bg-ink-800 font-medium text-ink-100"
          : "text-ink-400 hover:bg-ink-800/60 hover:text-ink-200",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
      <span
        className={cn(
          "flex-none font-mono text-[10.5px] tabular-nums",
          count === 0 ? "text-ink-600" : "text-ink-500",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function PinButton({
  pinned,
  name,
  onToggle,
}: {
  pinned: boolean;
  name: string;
  onToggle: () => void;
}) {
  return (
    <button
      className={cn(
        "absolute right-2.5 top-2.5 rounded-md border bg-background px-[9px] py-[3px] text-[11.5px] font-medium transition-[background-color,border-color,color,opacity] duration-[130ms] ease-brand focus-visible:opacity-100 group-hover:opacity-100",
        pinned
          ? "border-ink-600 bg-ink-800 text-ink-200 opacity-100"
          : "border-ink-700 text-ink-300 opacity-0 hover:border-ink-500 hover:text-ink-100",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
    >
      {pinned ? "Pinned ✓" : "+ Pin"}
    </button>
  );
}
