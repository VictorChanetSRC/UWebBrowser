export type HistoryEntry = {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
};

/** One navigation event. Unlike HistoryEntry (aggregated per URL for the
 *  omnibox), the visit log keeps every visit with its own timestamp — it's
 *  what the uwb://history page browses. */
export type Visit = {
  url: string;
  title: string;
  ts: number;
};

const KEY = "uwb.history";
const LOG_KEY = "uwb.history.log";
const MAX_ENTRIES = 500;
const MAX_VISITS = 5000;

let cache: HistoryEntry[] | null = null;
let logCache: Visit[] | null = null;
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

/** Visit log, stored oldest → newest. */
function loadLog(): Visit[] {
  if (logCache) return logCache;
  try {
    const raw = localStorage.getItem(LOG_KEY);
    logCache = raw ? (JSON.parse(raw) as Visit[]) : null;
  } catch {
    logCache = null;
  }
  if (!logCache) {
    // First run since the log was introduced: seed it from the aggregate
    // store so pre-existing history shows up on the History page — one visit
    // per known page, at its last-visited time.
    logCache = load()
      .map((e): Visit => ({ url: e.url, title: e.title, ts: e.lastVisit }))
      .sort((a, b) => a.ts - b.ts);
  }
  return logCache;
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
  if (logCache) localStorage.setItem(LOG_KEY, JSON.stringify(logCache));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flush);
}

export function recordVisit(url: string, title: string) {
  if (!/^https?:\/\//i.test(url)) return;
  const entries = load();
  const log = loadLog();
  const now = Date.now();
  const existing = entries.find((entry) => entry.url === url);
  if (existing) {
    // A single page load can report its URL more than once (navigation +
    // load-finished); only count it as a new visit after a real gap.
    if (now - existing.lastVisit > 5_000) {
      existing.visits += 1;
      log.push({ url, title: title || existing.title, ts: now });
    }
    existing.lastVisit = now;
    if (title) existing.title = title;
  } else {
    entries.push({ url, title, visits: 1, lastVisit: now });
    log.push({ url, title, ts: now });
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b.lastVisit - a.lastVisit);
      entries.length = MAX_ENTRIES;
    }
  }
  if (log.length > MAX_VISITS) log.splice(0, log.length - MAX_VISITS);
  persist();
}

/** Titles arrive after navigation; attach them to the already-recorded visit. */
export function updateTitle(url: string, title: string) {
  if (!title) return;
  let changed = false;
  const entry = load().find((e) => e.url === url);
  if (entry && entry.title !== title) {
    entry.title = title;
    changed = true;
  }
  // Patch the latest logged visit of that page — it's the one this title
  // belongs to. Older visits keep whatever title they were recorded with.
  const log = loadLog();
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].url === url) {
      if (log[i].title !== title) {
        log[i].title = title;
        changed = true;
      }
      break;
    }
  }
  if (changed) persist();
}

/** Every recorded visit, newest first. Returns a copy — safe to filter. */
export function getVisits(): Visit[] {
  return [...loadLog()].reverse();
}

/** Remove one visit from the log, keeping the omnibox aggregate in step:
 *  its visit count and last-visit time are recomputed from what remains,
 *  and the page drops out of suggestions once its last visit is gone. */
export function deleteVisit(url: string, ts: number) {
  const log = loadLog();
  const index = log.findIndex((v) => v.url === url && v.ts === ts);
  if (index === -1) return;
  log.splice(index, 1);
  const entries = load();
  const entry = entries.find((e) => e.url === url);
  if (entry) {
    const remaining = log.filter((v) => v.url === url);
    if (remaining.length === 0) {
      entries.splice(entries.indexOf(entry), 1);
    } else {
      entry.visits = remaining.length;
      entry.lastVisit = remaining[remaining.length - 1].ts;
    }
  }
  persist();
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
  logCache = [];
  localStorage.removeItem(KEY);
  localStorage.removeItem(LOG_KEY);
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
