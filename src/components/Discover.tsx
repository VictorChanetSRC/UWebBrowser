import { useMemo, useState } from "react";
import { discoverCatalog } from "../lib/discover";
import type { LinkItem } from "../lib/engines";
import { LinkCard, LinkGrid } from "./LinkCard";
import { SearchField } from "./SearchField";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { RailButton } from "@/components/ui/rail-button";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/page-shell";

type Props = {
  pinnedUrls: Set<string>;
  onOpen: (url: string) => void;
  onTogglePin: (item: LinkItem) => void;
};

// The searchable text for every catalog item, lowercased once at module load
// instead of rebuilt for all 66 items on every keystroke.
const SEARCH_INDEX = discoverCatalog.map((group) => ({
  group,
  items: group.items.map((item) => ({
    item,
    text: `${item.name} ${item.hint ?? ""} ${group.category}`.toLowerCase(),
  })),
}));

export function Discover({ pinnedUrls, onOpen, onTogglePin }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  // Match counts per category ignore the category filter, so the rail keeps
  // showing where else the search hits while one category is selected. Memoized
  // so a pin toggle (which re-renders with new pinnedUrls) doesn't refilter.
  const matches = useMemo(
    () =>
      SEARCH_INDEX.map(({ group, items }) => ({
        ...group,
        items: q ? items.filter((e) => e.text.includes(q)).map((e) => e.item) : group.items,
      })),
    [q],
  );
  const total = useMemo(
    () => matches.reduce((sum, group) => sum + group.items.length, 0),
    [matches],
  );
  const groups = useMemo(
    () =>
      matches.filter(
        (group) => group.items.length > 0 && (!category || group.category === category),
      ),
    [matches, category],
  );

  const pick = (next: string | null) =>
    setCategory(next !== null && category === next ? null : next);

  return (
    <PageShell width="max-w-[1460px]">
        <PageHeader
          kicker="Discover"
          title="The Unreal dev toolbox."
          description="Curated tools, assets, learning and communities for Unreal Engine developers. Pin anything to your work bar."
        />

        {/* Wide windows trade the chip row for a sticky category rail. */}
        <div className="grid gap-x-12 gap-y-9 @4xl:grid-cols-[220px_minmax(0,1fr)] @4xl:items-start">
          <nav
            className="hidden @4xl:flex @4xl:sticky @4xl:top-10 flex-col gap-0.5"
            aria-label="Categories"
          >
            <Label size="micro" className="px-2.5 pb-2">Browse</Label>
            <RailButton
              label="All"
              count={total}
              active={category === null}
              onClick={() => pick(null)}
            />
            {matches.map((group) => (
              <RailButton
                key={group.category}
                label={group.category}
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
              <EmptyState title={`Nothing matches "${query}".`}>
                <p className="text-[12.5px] text-ink-500">Try another word.</p>
              </EmptyState>
            )}
          </div>
        </div>
    </PageShell>
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
