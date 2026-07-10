import { useMemo, useState } from "react";
import { History as HistoryIcon, Trash2, X } from "lucide-react";
import { clearHistory, deleteVisit, getVisits, type Visit } from "../lib/history";
import { SearchField } from "./SearchField";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/page-shell";
import { SiteIcon, SiteLabel } from "@/components/ui/site-row";
import { ChipGroup } from "@/components/ui/chip-group";

type Props = {
  onOpen: (url: string) => void;
};

type RangeKey = "all" | "today" | "yesterday" | "week" | "month";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "Last 30 days" },
];

const DAY_MS = 86_400_000;
/** Rows rendered before "Show more" — keeps a 5000-visit log from mounting
 *  thousands of DOM nodes at once. */
const PAGE_SIZE = 200;

function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** [from, to) window of a range filter, in epoch ms. */
function rangeBounds(key: RangeKey, now: number): [number, number] {
  const today = startOfToday(now);
  switch (key) {
    case "today":
      return [today, Infinity];
    case "yesterday":
      return [today - DAY_MS, today];
    case "week":
      return [today - 6 * DAY_MS, Infinity];
    case "month":
      return [today - 29 * DAY_MS, Infinity];
    default:
      return [0, Infinity];
  }
}

function dayLabel(ts: number, now: number): string {
  const date = new Date(ts);
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((startOfToday(now) - dayStart.getTime()) / DAY_MS);
  const formatted = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(date.getFullYear() !== new Date(now).getFullYear()
      ? { year: "numeric" as const }
      : {}),
  });
  if (daysAgo === 0) return `Today · ${formatted}`;
  if (daysAgo === 1) return `Yesterday · ${formatted}`;
  return formatted;
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function History({ onOpen }: Props) {
  const [visits, setVisits] = useState<Visit[]>(getVisits);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<RangeKey>("all");
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  const clearAll = () => {
    clearHistory();
    setVisits([]);
  };

  // One clock per render keeps "Today" headings and range bounds consistent.
  const now = Date.now();

  const filtered = useMemo(() => {
    const [from, to] = rangeBounds(range, now);
    const q = query.trim().toLowerCase();
    return visits.filter((visit) => {
      if (visit.ts < from || visit.ts >= to) return false;
      if (!q) return true;
      return (
        visit.title.toLowerCase().includes(q) ||
        visit.url.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, query, range]);

  // Visits arrive newest-first; keep that order and split on day boundaries.
  const groups = useMemo(() => {
    const out: { label: string; visits: Visit[] }[] = [];
    let currentDay = "";
    for (const visit of filtered.slice(0, shownCount)) {
      const day = new Date(visit.ts).toDateString();
      if (day !== currentDay) {
        currentDay = day;
        out.push({ label: dayLabel(visit.ts, now), visits: [] });
      }
      out[out.length - 1].visits.push(visit);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, shownCount]);

  const setFilter = (next: RangeKey) => {
    setRange(next);
    setShownCount(PAGE_SIZE);
  };

  const handleQuery = (value: string) => {
    setQuery(value);
    setShownCount(PAGE_SIZE);
  };

  const removeVisit = (visit: Visit) => {
    deleteVisit(visit.url, visit.ts);
    setVisits(getVisits());
  };

  return (
    <PageShell gap="gap-7">
        <PageHeader
          kicker="History"
          title="Where you’ve been."
          description="Every page you’ve visited, newest first. Search it, narrow it to a day, or prune what you don’t want remembered."
        />

        <div className="flex flex-col gap-3.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <SearchField
                placeholder="Search titles and addresses"
                value={query}
                onValueChange={handleQuery}
              />
            </div>
            <ConfirmButton
              className="h-[54px] flex-none rounded-xl px-5"
              disabled={visits.length === 0}
              onConfirm={clearAll}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Clear all
            </ConfirmButton>
          </div>
          <ChipGroup options={RANGES} value={range} onPick={setFilter}>
            <span className="ml-auto text-[12.5px] text-ink-500">
              {filtered.length} {filtered.length === 1 ? "visit" : "visits"}
              {filtered.length !== visits.length && ` of ${visits.length}`}
            </span>
          </ChipGroup>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="size-6 text-ink-600" aria-hidden />}
            title={visits.length === 0 ? "No history yet" : "Nothing matches these filters"}
          >
            <p className="text-[12.5px] text-ink-500">
              {visits.length === 0
                ? "Pages you visit will show up here as you browse."
                : "Try a different search or a wider time range."}
            </p>
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.label}>
                <Label className="block pb-2.5">{group.label}</Label>
                <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
                  {group.visits.map((visit) => (
                    <div
                      key={`${visit.ts}-${visit.url}`}
                      className="group flex items-center gap-1 pr-2"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-[9px] text-left transition-[background-color] duration-[130ms] ease-brand hover:bg-ink-900"
                        onClick={() => onOpen(visit.url)}
                        title={visit.url}
                      >
                        <span className="w-[44px] flex-none font-mono text-[11.5px] text-ink-500">
                          {timeLabel(visit.ts)}
                        </span>
                        <SiteIcon url={visit.url} />
                        <SiteLabel
                          title={visit.title}
                          url={visit.url}
                          className="text-[12.5px] text-ink-200"
                        />
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "flex size-6 flex-none items-center justify-center rounded-full text-ink-500 opacity-0 transition-[background-color,color,opacity] duration-[130ms] ease-brand",
                          "hover:bg-ink-800 hover:text-ink-100 focus-visible:opacity-100 group-hover:opacity-100",
                        )}
                        onClick={() => removeVisit(visit)}
                        aria-label={`Remove ${visit.title || visit.url} from history`}
                        title="Remove from history"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {filtered.length > shownCount && (
              <Button
                className="self-center"
                onClick={() => setShownCount((n) => n + PAGE_SIZE)}
              >
                Show more ({filtered.length - shownCount} older)
              </Button>
            )}
          </div>
        )}
    </PageShell>
  );
}
