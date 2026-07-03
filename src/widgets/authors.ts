/**
 * Widget authors. An author is a profile object that widget specs point at
 * via their `creator` field — define yours once (here, or in your own
 * module) and reuse it across every widget you make. The shop groups
 * widgets by `id` and renders an author page for each: profile, credits,
 * and every widget they've shipped.
 */
export type WidgetAuthor = {
  /** Stable slug that groups an author's widgets, e.g. "victor-chanet". */
  id: string;
  name: string;
  /** One line under the name on the author page. */
  tagline?: string;
  /** A short paragraph for the author page; two sentences, no résumé. */
  bio?: string;
  /** Their place on the web; the author page links out to it. */
  url?: string;
};

/** The house author: every widget that ships with UWebBrowser. */
export const VICTOR_CHANET: WidgetAuthor = {
  id: "victor-chanet",
  name: "Victor Chanet",
  tagline: "Author of UWebBrowser.",
  bio:
    "Building the browser for Unreal Engine developers at Victor Game " +
    "Studio. Every widget in the box starts here — and the shop is open " +
    "for yours.",
  url: "https://victorgamestudio.com",
};

/** "Victor Chanet" → "VC", for the author page monogram. */
export function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}
