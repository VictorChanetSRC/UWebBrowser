import { type LinkItem } from "./engines";
import { loadJson, saveJson } from "./storage";
import { moveBy, patchById, removeById, uid } from "./list-ops";
import {
  BAR_WIDGET_TYPES,
  newBarWidget,
  type LinksWidget,
  type Widget,
  type WidgetType,
} from "@/widgets/workbar";

/**
 * The work bar is an ordered stack of widgets. Link lists carry their own
 * items; live widgets (Steam, build, system, itch) fetch on their own and
 * only persist their settings here. This module owns storage and bar
 * mutations; what a widget *is* lives in src/widgets/workbar (one spec file
 * per widget — see docs/WIDGETS.md).
 */

// The widget vocabulary, re-exported so bar consumers have one import.
export { newBarWidget, type LinksWidget, type Widget, type WidgetType } from "@/widgets/workbar";

const KEY = "uwb.workbar";
// Pre-widget installs stored plain link sections under these keys.
const PINS_KEY = "uwb.pins";
const LEGACY_PINS_KEY = "gdb.pins";

const statusWidgets = (): Widget[] => [
  { id: uid(), type: "steam-game", gameId: null },
  { id: uid(), type: "steam-players", gameId: null },
  { id: uid(), type: "build" },
  { id: uid(), type: "system" },
];

/** First-run work bar: live status widgets only. Link lists start empty —
 *  users pin the pages they care about with the toolbar star. */
export function seedWidgets(): Widget[] {
  return [...statusWidgets()];
}

export function loadWidgets(): Widget[] {
  // The current board lives under KEY; pre-widget installs kept plain link
  // sections under the pins keys. loadJson tries them in order — the validator
  // routes each shape and returns null to fall through to the next key.
  return loadJson<Widget[]>(
    [KEY, PINS_KEY, LEGACY_PINS_KEY],
    (raw) => {
      if (!Array.isArray(raw)) return null;
      const items = raw as Array<{ type?: unknown; label?: unknown; items?: unknown } | null>;
      const looksLikeWidgets = items.some((w) => w && typeof w.type === "string");
      if (looksLikeWidgets) {
        // The one-card Steam ticker split into a game card and a players
        // graph; expand stored copies into both so nobody loses a widget.
        const expanded = items.flatMap((w) =>
          w && w.type === "steam"
            ? [
                { ...w, type: "steam-game" },
                { id: uid(), type: "steam-players", gameId: (w as { gameId?: unknown }).gameId ?? null },
              ]
            : [w],
        );
        const widgets = expanded.filter(
          (w): w is Widget => !!w && BAR_WIDGET_TYPES.includes(w.type as WidgetType),
        );
        if (widgets.length === 0) return null;
        if (expanded.length !== items.length) saveWidgets(widgets);
        return widgets;
      }
      // Pre-widget work bar: keep the link sections, add the live widgets.
      return [
        ...statusWidgets(),
        ...items.map(
          (section): Widget => ({
            id: uid(),
            type: "links",
            label: String(section?.label ?? "Links"),
            items: Array.isArray(section?.items) ? section.items : [],
          }),
        ),
      ];
    },
    () => seedWidgets(),
  );
}

export function saveWidgets(widgets: Widget[]) {
  saveJson(KEY, widgets);
}

export function addWidget(widgets: Widget[], type: WidgetType): Widget[] {
  return [...widgets, newBarWidget(type)];
}

export function removeWidget(widgets: Widget[], id: string): Widget[] {
  return removeById(widgets, id);
}

export function moveWidget(widgets: Widget[], id: string, dir: -1 | 1): Widget[] {
  return moveBy(widgets, id, dir);
}

export function updateWidget(widgets: Widget[], id: string, patch: Partial<Widget>): Widget[] {
  return patchById(widgets, id, patch);
}

/* ----- pinned links, shared with the toolbar pin button and Discover ----- */

const linkWidgets = (widgets: Widget[]): LinksWidget[] =>
  widgets.filter((w): w is LinksWidget => w.type === "links");

export function pinnedUrls(widgets: Widget[]): Set<string> {
  return new Set(linkWidgets(widgets).flatMap((w) => w.items.map((i) => i.url)));
}

export function isPinned(widgets: Widget[], url: string): boolean {
  return linkWidgets(widgets).some((w) => w.items.some((i) => i.url === url));
}

/** Pin into the "Pinned" list (created on demand), or unpin from wherever it lives. */
export function togglePin(widgets: Widget[], item: LinkItem): Widget[] {
  if (isPinned(widgets, item.url)) {
    return widgets.map((w) =>
      w.type === "links" ? { ...w, items: w.items.filter((i) => i.url !== item.url) } : w,
    );
  }
  const pinned = linkWidgets(widgets).find((w) => w.label === "Pinned");
  if (pinned) {
    return widgets.map((w) =>
      w.id === pinned.id && w.type === "links" ? { ...w, items: [...w.items, item] } : w,
    );
  }
  return [{ id: uid(), type: "links", label: "Pinned", items: [item] }, ...widgets];
}
