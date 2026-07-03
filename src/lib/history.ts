export type HistoryEntry = {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
};

const KEY = "uwb.history";
const MAX_ENTRIES = 500;

let cache: HistoryEntry[] | null = null;
let persistTimer: number | null = null;

function load(): HistoryEntry[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Debounced: one page load fires several URL events (navigation, redirects,
 *  load-finished), and each was serializing up to 500 entries synchronously on
 *  the UI thread mid-navigation. Coalesce them, and flush on unload. */
function persist() {
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(flush, 400);
}

function flush() {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (cache) localStorage.setItem(KEY, JSON.stringify(cache));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flush);
}

export function recordVisit(url: string, title: string) {
  if (!/^https?:\/\//i.test(url)) return;
  const entries = load();
  const now = Date.now();
  const existing = entries.find((entry) => entry.url === url);
  if (existing) {
    // A single page load can report its URL more than once (navigation +
    // load-finished); only count it as a new visit after a real gap.
    if (now - existing.lastVisit > 5_000) existing.visits += 1;
    existing.lastVisit = now;
    if (title) existing.title = title;
  } else {
    entries.push({ url, title, visits: 1, lastVisit: now });
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b.lastVisit - a.lastVisit);
      entries.length = MAX_ENTRIES;
    }
  }
  persist();
}

/** Titles arrive after navigation; attach them to the already-recorded visit. */
export function updateTitle(url: string, title: string) {
  if (!title) return;
  const entry = load().find((e) => e.url === url);
  if (entry && entry.title !== title) {
    entry.title = title;
    persist();
  }
}

export function historyCount(): number {
  return load().length;
}

export function clearHistory() {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  cache = [];
  localStorage.removeItem(KEY);
}

/**
 * Rank history against what's typed in the address bar. Host-prefix matches
 * beat URL substring matches beat title matches; frequency and recency break
 * ties, the way an omnibox is expected to feel.
 */
export function suggestFromHistory(query: string, limit = 5): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const now = Date.now();
  const scored: { entry: HistoryEntry; score: number }[] = [];
  for (const entry of load()) {
    const bare = entry.url.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
    let score = 0;
    if (bare.startsWith(q)) score = 4;
    else if (bare.includes(q)) score = 2;
    else if (entry.title.toLowerCase().includes(q)) score = 1;
    if (!score) continue;
    const ageDays = (now - entry.lastVisit) / 86_400_000;
    score += Math.log2(1 + entry.visits) * 0.5 + Math.max(0, 1 - ageDays / 30) * 0.5;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}
