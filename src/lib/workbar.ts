import { sidebarSections, type LinkItem } from "./engines";
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

const uid = () => crypto.randomUUID();

const statusWidgets = (): Widget[] => [
  { id: uid(), type: "steam-game", gameId: null },
  { id: uid(), type: "steam-players", gameId: null },
  { id: uid(), type: "build" },
  { id: uid(), type: "system" },
];

/** First-run work bar: live widgets on top, curated link lists below. */
export function seedWidgets(): Widget[] {
  return [
    ...statusWidgets(),
    ...sidebarSections().map(
      (section): Widget => ({
        id: uid(),
        type: "links",
        label: section.label,
        items: section.items,
      }),
    ),
  ];
}

export function loadWidgets(): Widget[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // The one-card Steam ticker split into a game card and a players
        // graph; expand stored copies into both so nobody loses a widget.
        const expanded = parsed.flatMap((w) =>
          w && w.type === "steam"
            ? [
                { ...w, type: "steam-game" },
                { id: uid(), type: "steam-players", gameId: w.gameId ?? null },
              ]
            : [w],
        );
        const widgets = expanded.filter(
          (w): w is Widget => w && BAR_WIDGET_TYPES.includes(w.type),
        );
        if (widgets.length > 0) {
          if (expanded.length !== parsed.length) saveWidgets(widgets);
          return widgets;
        }
      }
    }
    // Migrate a pre-widget work bar: keep the link sections, add the live widgets.
    const pins = localStorage.getItem(PINS_KEY) ?? localStorage.getItem(LEGACY_PINS_KEY);
    if (pins) {
      const sections = JSON.parse(pins);
      if (Array.isArray(sections)) {
        return [
          ...statusWidgets(),
          ...sections.map(
            (section): Widget => ({
              id: uid(),
              type: "links",
              label: String(section.label ?? "Links"),
              items: Array.isArray(section.items) ? section.items : [],
            }),
          ),
        ];
      }
    }
  } catch {
    // fall through to seed
  }
  return seedWidgets();
}

export function saveWidgets(widgets: Widget[]) {
  localStorage.setItem(KEY, JSON.stringify(widgets));
}

export function addWidget(widgets: Widget[], type: WidgetType): Widget[] {
  return [...widgets, newBarWidget(type)];
}

export function removeWidget(widgets: Widget[], id: string): Widget[] {
  return widgets.filter((w) => w.id !== id);
}

export function moveWidget(widgets: Widget[], id: string, dir: -1 | 1): Widget[] {
  const from = widgets.findIndex((w) => w.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= widgets.length) return widgets;
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function updateWidget(widgets: Widget[], id: string, patch: Partial<Widget>): Widget[] {
  return widgets.map((w) => (w.id === id ? ({ ...w, ...patch } as Widget) : w));
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
