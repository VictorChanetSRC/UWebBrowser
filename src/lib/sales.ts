/** Shared vocabulary for the two revenue widgets, so the board tile and the
 *  rail widget never disagree about what a number means. */

/**
 * Steam reports *net sales* — gross less returns and tax — which is still the
 * whole storefront figure, before Valve's cut. Developers want the half of it
 * they actually bank, and that split isn't the same for everyone: the standard
 * tier is 70%, it steps up past $10M and $50M of lifetime revenue, and a
 * publisher deal can be anything. So it's a widget setting, not a constant.
 */
export const DEFAULT_SHARE_PCT = 70;

export const SHARE_OPTIONS = [70, 75, 80, 100] as const;

/** What a share percentage is called on a chip and in the tile's footer. */
export const shareLabel = (pct: number): string => (pct === 100 ? "Net sales" : `${pct}% share`);

/** Your slice of a net-sales figure. */
export const share = (netUsd: number, pct: number): number => (netUsd * pct) / 100;

/**
 * The line every revenue surface closes with. Steam settles in Pacific days and
 * keeps adjusting them for a while, so a tile that says "today" is guessing;
 * one that names the day it's showing is not.
 */
export const SALES_CAVEAT =
  "Steam settles daily, Pacific time. Recent days can still move as transactions clear.";

/** Shown when no publisher key is on file. */
export const NOT_CONNECTED = "Connect Steamworks to see what your games earn.";

/** Shown once connected, before the first day of sales has ever settled. */
export const NO_SALES_YET = "No settled sales yet. The first day lands about a day after it ends.";

/* ----------------------------------- itch ---------------------------------- */

/**
 * itch.io publishes a running lifetime total and no history at all — no
 * purchase feed, no time series, nothing dated. So the daily figures are ours:
 * we diff the running total between polls. Every itch revenue surface has to
 * say this, because a chart that starts mid-life looks like a crash otherwise.
 */
export const ITCH_CAVEAT =
  "itch.io reports a lifetime total, not a history. Daily figures are measured here.";

export const ITCH_NO_KEY = "Add your itch.io API key in setup to see earnings.";

export const ITCH_NO_EARNINGS = "No earnings on this account yet.";

/** Only the dominant currency is charted; the rest are counted, never summed. */
export const otherCurrencies = (count: number): string | null =>
  count > 1 ? `${count - 1} other ${count === 2 ? "currency" : "currencies"} not shown.` : null;
