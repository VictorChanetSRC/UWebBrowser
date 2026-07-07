/** Client-side model for the downloads panel + top-bar progress ring. The
 *  backend streams raw `download` tab-events (see webext.rs); this turns that
 *  stream into a stable, newest-first list with derived transfer speed, and
 *  persists a capped history to localStorage so past downloads survive a
 *  restart (like history and the session do). */

export type DownloadState = "active" | "done" | "fail" | "cancel";

export type DownloadRec = {
  /** Backend-assigned id (`dl1`, `dl2`, …); stable for a download's lifetime. */
  id: string;
  name: string;
  path: string;
  url: string;
  state: DownloadState;
  received: number;
  /** Total bytes, or -1 when the server sent no content length. */
  total: number;
  /** ms epoch — sort key and persisted "when". */
  startedAt: number;
  /** Bytes/sec, smoothed; 0 unless actively downloading. */
  speed: number;
  /** Transient speed-sampling anchors (never persisted). */
  sampleAt?: number;
  sampleBytes?: number;
};

/** The raw JSON payload carried in a `download` tab-event's `value`. */
type RawDownloadEvent = {
  id: string;
  state: "start" | "progress" | "done" | "fail" | "cancel";
  name: string;
  path: string;
  url: string;
  received: number;
  total: number;
};

const STORAGE_KEY = "uwb.downloads";
/** Cap the kept history; active rows are never trimmed. */
const MAX_ITEMS = 60;
/** Re-sample speed at most this often, so the number doesn't jitter per event. */
const SAMPLE_MS = 400;
/** Exponential smoothing factor for the speed readout. */
const SPEED_EMA = 0.35;

export function parseDownloadEvent(value: string): RawDownloadEvent | null {
  try {
    const raw = JSON.parse(value) as RawDownloadEvent;
    if (!raw || typeof raw.id !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

const stateFor = (s: RawDownloadEvent["state"]): DownloadState =>
  s === "start" || s === "progress" ? "active" : s;

/** Fold one raw event into the list, returning a new array (newest first) with
 *  updated progress and smoothed speed. `now` is a `performance.now()`-style or
 *  epoch millisecond clock — only deltas are used for speed. */
export function applyDownloadEvent(
  items: DownloadRec[],
  raw: RawDownloadEvent,
  now: number,
): DownloadRec[] {
  const state = stateFor(raw.state);
  const existing = items.find((d) => d.id === raw.id);

  if (!existing) {
    const rec: DownloadRec = {
      id: raw.id,
      name: raw.name,
      path: raw.path,
      url: raw.url,
      state,
      received: Math.max(0, raw.received),
      total: raw.total,
      startedAt: now,
      speed: 0,
      sampleAt: now,
      sampleBytes: Math.max(0, raw.received),
    };
    return trim([rec, ...items]);
  }

  const next: DownloadRec = {
    ...existing,
    // Keep the first non-empty name/path/url — the start event may precede the
    // final resolved path.
    name: raw.name || existing.name,
    path: raw.path || existing.path,
    url: raw.url || existing.url,
    state,
    received: Math.max(existing.received, raw.received),
    total: raw.total >= 0 ? raw.total : existing.total,
  };

  if (state === "active") {
    const lastAt = existing.sampleAt ?? existing.startedAt;
    const dt = now - lastAt;
    if (dt >= SAMPLE_MS) {
      const db = next.received - (existing.sampleBytes ?? next.received);
      const inst = db > 0 && dt > 0 ? (db / dt) * 1000 : 0;
      next.speed = existing.speed
        ? existing.speed * (1 - SPEED_EMA) + inst * SPEED_EMA
        : inst;
      next.sampleAt = now;
      next.sampleBytes = next.received;
    }
  } else {
    // Terminal: freeze speed and, on success, treat received as the final size
    // when the server never reported a total.
    next.speed = 0;
    if (state === "done" && next.total < 0) next.total = next.received;
  }

  return items.map((d) => (d.id === raw.id ? next : d));
}

/** Keep the list bounded: all active rows plus the most recent finished ones. */
function trim(items: DownloadRec[]): DownloadRec[] {
  if (items.length <= MAX_ITEMS) return items;
  const active = items.filter((d) => d.state === "active");
  const finished = items.filter((d) => d.state !== "active");
  return [...active, ...finished].slice(0, Math.max(MAX_ITEMS, active.length));
}

/** Aggregate fraction complete across active downloads with a known total, or
 *  null when nothing active (or every active total is unknown → indeterminate). */
export function activeProgress(items: DownloadRec[]): number | null {
  const active = items.filter((d) => d.state === "active");
  if (active.length === 0) return null;
  const sized = active.filter((d) => d.total > 0);
  if (sized.length === 0) return null;
  const received = sized.reduce((sum, d) => sum + Math.min(d.received, d.total), 0);
  const total = sized.reduce((sum, d) => sum + d.total, 0);
  return total > 0 ? Math.min(1, received / total) : null;
}

export const countActive = (items: DownloadRec[]): number =>
  items.filter((d) => d.state === "active").length;

export function loadDownloads(): DownloadRec[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DownloadRec[];
    if (!Array.isArray(parsed)) return [];
    // A download can't survive the app closing, so anything left "active" was
    // interrupted — show it as failed rather than a forever-spinning row.
    return parsed.map((d) =>
      d.state === "active" ? { ...d, state: "fail", speed: 0 } : { ...d, speed: 0 },
    );
  } catch {
    return [];
  }
}

export function saveDownloads(items: DownloadRec[]): void {
  try {
    // Persist a slim projection: drop the transient speed-sampling anchors.
    const slim = items.slice(0, MAX_ITEMS).map(({ sampleAt, sampleBytes, ...rest }) => {
      void sampleAt;
      void sampleBytes;
      return rest;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    /* storage full or unavailable — history is best-effort */
  }
}
