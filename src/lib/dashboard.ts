import type { Game } from "./config";
import { loadJson, saveJson } from "./storage";
import { moveBy, moveTo, patchById, removeById, uid } from "./list-ops";
import {
  DASH_WIDGET_TYPES,
  defaultTileSpan,
  newDashWidget,
  type DashWidget,
  type DashWidgetType,
  type TileSpan,
} from "@/widgets/dashboard";

/**
 * The home page is an ordered set of tiles, same contract as the work bar:
 * live widgets fetch on their own and only persist their settings here.
 * This module owns storage and board mutations; what a widget *is* lives in
 * src/widgets/dashboard (one spec file per widget — see docs/WIDGETS.md).
 * Widgets that track "a game" carry a gameId; null falls back to the first
 * game on the setup, so a fresh seed follows renames and reorders for free.
 */

// The widget vocabulary, re-exported so board consumers have one import.
export {
  cycleSpan,
  defaultTileSpan,
  MAX_SPAN,
  newDashWidget,
  SPAN_PRESETS,
  spanLabel,
  type DashWidget,
  type DashWidgetType,
  type TileSpan,
} from "@/widgets/dashboard";

type GameWidget = Extract<DashWidget, { type: "game" }>;

const KEY = "uwb.dashboard";

/** Boards saved before free spans stored one of four size letters. */
const LEGACY_SIZES: Record<string, TileSpan> = {
  s: { c: 1, r: 1 },
  w: { c: 2, r: 1 },
  t: { c: 1, r: 2 },
  l: { c: 2, r: 2 },
};

const clampAxis = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.min(3, Math.max(1, Math.round(n)))
    : null;

/** Whatever a stored board carries — a span, a legacy size letter, or
 *  nothing — comes out as a valid span. */
function normalizeSpan(value: unknown, type: DashWidgetType): TileSpan {
  if (typeof value === "string" && LEGACY_SIZES[value]) return LEGACY_SIZES[value];
  if (value && typeof value === "object") {
    const c = clampAxis((value as TileSpan).c);
    const r = clampAxis((value as TileSpan).r);
    if (c && r) return { c, r };
  }
  return defaultTileSpan(type);
}

/** First-run home page: your games up top, then the world outside. */
export function seedDashboard(games: Game[]): DashWidget[] {
  const span = defaultTileSpan;
  const gameTiles: DashWidget[] =
    games.length > 0
      ? games.map((g) => ({ id: uid(), type: "game", span: span("game"), gameId: g.id }))
      : [{ id: uid(), type: "game", span: span("game"), gameId: null }];
  return [
    ...gameTiles,
    { id: uid(), type: "build", span: span("build"), gameId: null },
    { id: uid(), type: "buzz", span: span("buzz"), gameId: null },
    { id: uid(), type: "news", span: span("news"), source: "unreal" },
    { id: uid(), type: "news", span: span("news"), source: "gamedeveloper" },
    { id: uid(), type: "steamList", span: span("steamList"), category: "coming_soon" },
    { id: uid(), type: "epicFree", span: span("epicFree") },
    { id: uid(), type: "itch", span: span("itch") },
    { id: uid(), type: "workspace", span: span("workspace") },
  ];
}

export function loadDashboard(games: Game[]): DashWidget[] {
  return loadJson<DashWidget[]>(
    [KEY],
    (raw) => {
      if (!Array.isArray(raw)) return null;
      const widgets = raw
        .filter((w): w is DashWidget => w && DASH_WIDGET_TYPES.includes(w.type))
        .map((w) => ({
          ...w,
          span: normalizeSpan(
            (w as { span?: unknown; size?: unknown }).span ??
              (w as { size?: unknown }).size,
            w.type,
          ),
        }));
      return widgets.length > 0 ? reconcileDashboard(widgets, games) : null;
    },
    () => seedDashboard(games),
  );
}

export function saveDashboard(widgets: DashWidget[]) {
  saveJson(KEY, widgets);
}

/**
 * Keep the board honest after setup changes: pointers to deleted games fall
 * back to "first game", and every game gets a tile the moment it exists —
 * added right after the tiles of its siblings.
 */
export function reconcileDashboard(widgets: DashWidget[], games: Game[]): DashWidget[] {
  const ids = new Set(games.map((g) => g.id));
  let next = widgets.map((w) =>
    "gameId" in w && w.gameId && !ids.has(w.gameId)
      ? ({ ...w, gameId: null } as DashWidget)
      : w,
  );
  const covered = new Set(
    next
      .filter((w): w is GameWidget => w.type === "game")
      .map((w) => w.gameId ?? games[0]?.id),
  );
  const missing = games.filter((g) => !covered.has(g.id));
  if (missing.length > 0) {
    const insertAt = next.reduce((at, w, i) => (w.type === "game" ? i + 1 : at), 0);
    next = [
      ...next.slice(0, insertAt),
      ...missing.map(
        (g): DashWidget => ({ id: uid(), type: "game", span: defaultTileSpan("game"), gameId: g.id }),
      ),
      ...next.slice(insertAt),
    ];
  }
  return next;
}

export function addDashWidget(widgets: DashWidget[], type: DashWidgetType): DashWidget[] {
  return [...widgets, newDashWidget(type)];
}

export function removeDashWidget(widgets: DashWidget[], id: string): DashWidget[] {
  return removeById(widgets, id);
}

export function moveDashWidget(widgets: DashWidget[], id: string, dir: -1 | 1): DashWidget[] {
  return moveBy(widgets, id, dir);
}

/** Move a widget to an absolute index; a no-op returns the same array. */
export function moveDashWidgetTo(widgets: DashWidget[], id: string, to: number): DashWidget[] {
  return moveTo(widgets, id, to);
}

export function updateDashWidget(
  widgets: DashWidget[],
  id: string,
  patch: Partial<DashWidget>,
): DashWidget[] {
  return patchById(widgets, id, patch);
}
