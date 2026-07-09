/** Small array helpers shared by the dashboard board and the work bar: both
 *  keep an ordered list of `{ id }` items and need the same reorder / remove /
 *  patch operations. Each module keeps its own typed `add` (it needs its own
 *  widget factory); everything else delegates here so the algorithms live once. */

export type WithId = { id: string };

/** Fresh id for a new `{ id }` list item. Shared so the dashboard board and the
 *  work bar mint ids the same way. */
export const uid = (): string => crypto.randomUUID();

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
