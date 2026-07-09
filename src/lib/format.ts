/** Number, duration and size formatting shared across the dashboard, sidebar
 *  and Unreal hub, so the same value never renders two ways. */

const numberFormat = new Intl.NumberFormat("en-US");

/** The glyph shown where a number isn't known yet. A mid-dot, not an em dash
 *  (banned brand-wide) and not a minus that could read as a negative value. */
export const MISSING = "·";

/** Thousands-separated integer, or {@link MISSING} for a null/NaN value. */
export function fmtNumber(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? MISSING : numberFormat.format(n);
}

/** `h:mm:ss` (or `m:ss` under an hour) for a millisecond span. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = `${m}`.padStart(2, "0");
  const ss = `${s}`.padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Elapsed clock since a start timestamp (ms epoch). */
export function elapsedSince(startedAt: number): string {
  return formatDuration(Date.now() - startedAt);
}

/** Bytes to gibibytes (numeric; the caller adds the unit). */
export function gb(bytes: number): number {
  return bytes / 1024 ** 3;
}

/** Human byte size — "0 B", "934 KB", "1.4 MB", "2.1 GB". Rounds to one
 *  decimal from MB up. Negative/unknown sizes render as {@link MISSING}. */
export function fmtBytes(bytes: number): string {
  if (bytes < 0 || Number.isNaN(bytes)) return MISSING;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Bytes-per-second as "1.2 MB/s". */
export function fmtSpeed(bytesPerSec: number): string {
  return `${fmtBytes(bytesPerSec)}/s`;
}

/** Relative "n min/h/d ago" for a unix-seconds timestamp. */
export function ago(utcSeconds: number): string {
  const seconds = Math.max(0, Date.now() / 1000 - utcSeconds);
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

/** Short "Jul 9" for a unix-seconds timestamp or ISO string. */
export function shortDate(input: number | string): string {
  const date = typeof input === "number" ? new Date(input * 1000) : new Date(input);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Feed timestamps: relative while fresh, calendar date once they age out. */
export function feedDate(utcSeconds: number): string {
  const days = (Date.now() / 1000 - utcSeconds) / 86400;
  return days < 7 ? ago(utcSeconds) : shortDate(utcSeconds);
}

/** The one "a data source didn't respond" line every live widget shows, so the
 *  ten network widgets phrase the failure identically. */
export function sourceError(source: string, error: unknown): string {
  return `${source} didn't answer: ${error}`;
}

/** USD cents to "$12.34" — Steam and Epic both quote cents here. */
export function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
