/** Small array helpers shared by the dashboard board and the work bar: both
 *  keep an ordered list of `{ id }` items and need the same reorder / remove /
 *  patch operations. Each module keeps its own typed `add` (it needs its own
 *  widget factory); everything else delegates here so the algorithms live once. */

export type WithId = { id: string };

/** Fresh id for a new `{ id }` list item. Shared so the dashboard board and the
 *  work bar mint ids the same way. */
export const uid = (): string => crypto.randomUUID();

/** The item with `id`, falling back to the first item (so a null/stale id
 *  follows the primary entry for free), then to null for an empty list. The
 *  rule every "tracked X" resolver needs — games, projects — in one place. */
export function pickById<T extends WithId>(items: T[], id: string | null | undefined): T | null {
  return items.find((item) => item.id === id) ?? items[0] ?? null;
}

export function removeById<T extends WithId>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

/** Move the item with `id` to an absolute index. An out-of-range target or a
 *  no-op move returns the same array reference. */
export function moveTo<T extends WithId>(items: T[], id: string, to: number): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0 || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move the item with `id` by a relative offset (e.g. -1 / +1). */
export function moveBy<T extends WithId>(items: T[], id: string, dir: number): T[] {
  const from = items.findIndex((item) => item.id === id);
  return moveTo(items, id, from + dir);
}

/** Shallow-merge `patch` into the item with `id`. */
export function patchById<T extends WithId>(items: T[], id: string, patch: Partial<T>): T[] {
  return items.map((item) => (item.id === id ? ({ ...item, ...patch } as T) : item));
}

/** How many of each `type` the list holds — what the widget shop shows on a
 *  card to say "you already have two of these". */
export function countByType<T extends string>(items: { type: T }[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  return counts;
}
