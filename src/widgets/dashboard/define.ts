import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { Game } from "@/lib/config";
import type { WidgetAuthor, WidgetShopInfo } from "../types";

/**
 * The contract for a home-board (dashboard) widget. One spec object holds
 * everything the app needs to know about a widget: its stored shape, its
 * shop listing, its icon, its live body, and its optional per-tile config.
 * Register specs in ./index.tsx; the full walkthrough is in docs/WIDGETS.md.
 */

/* ------------------------------- tile spans -------------------------------- */

/**
 * Bento footprint of a tile: how many grid columns and rows it covers. The
 * grid packs dense, so mixed spans interlock instead of leaving holes.
 */
export type TileSpan = { c: number; r: number };

/** Beyond 3×3 a tile stops being a tile and starts being the page. */
export const MAX_SPAN = 3;

/** The footprints the resize button cycles through; dragging a border can
 *  reach anything up to {@link MAX_SPAN}². */
export const SPAN_PRESETS: TileSpan[] = [
  { c: 1, r: 1 },
  { c: 2, r: 1 },
  { c: 1, r: 2 },
  { c: 2, r: 2 },
];

export const spanLabel = (span: TileSpan): string => `${span.c}×${span.r}`;

export function cycleSpan(span: TileSpan): TileSpan {
  const at = SPAN_PRESETS.findIndex((p) => p.c === span.c && p.r === span.r);
  // A drag-made span off the preset path rolls back to 1×1.
  return SPAN_PRESETS[(at + 1) % SPAN_PRESETS.length];
}

/* --------------------------------- widgets --------------------------------- */

/**
 * What every stored dashboard widget carries. A widget's own instance type
 * extends this with a literal `type` and whatever settings it persists —
 * settings only; live data is fetched by the body, never stored.
 */
export type DashWidgetBase = { id: string; type: string; span: TileSpan };

/** What the surface hands every widget body, with `widget` narrowed. */
export type DashBodyProps<W extends DashWidgetBase = DashWidgetBase> = {
  widget: W;
  games: Game[];
  itchApiKey: string;
  /** Gates polling; false when the page is hidden. */
  active: boolean;
  onOpen: (url: string) => void;
  onUnreal: () => void;
  onEditSetup: () => void;
};

/** Props for a widget's config strip (the chips shown in Customize mode). */
export type DashConfigProps<W extends DashWidgetBase = DashWidgetBase> = {
  widget: W;
  games: Game[];
  onPatch: (patch: Partial<W>) => void;
};

/**
 * Everything the app needs to know about one dashboard widget. Build one
 * with {@link defineDashWidget} and register it in ./index.tsx.
 */
export type DashWidgetSpec<W extends DashWidgetBase = DashWidgetBase> = {
  /** The discriminant; must match the instance type's `type` literal. */
  type: W["type"];
  icon: LucideIcon;
  /** Your author profile; powers the credit and your author page in the
   *  shop. Define it once and reuse it — see src/widgets/authors.ts. */
  creator: WidgetAuthor;
  /** The shop listing. */
  shop: WidgetShopInfo;
  /** The footprint a fresh tile is born with; users can resize later. */
  defaultSpan: TileSpan;
  /** Build a fresh instance; `base` carries a new id and the default span. */
  create: (base: { id: string; span: TileSpan }) => W;
  /** The title shown on tile chrome (Customize-mode handle, a11y labels). */
  title: (widget: W, games: Game[]) => string;
  /** The live body. Fetch in here (usePolled), gate on `active`. */
  Body: ComponentType<DashBodyProps<W>>;
  /**
   * Optional per-tile settings strip, rendered over the tile in Customize
   * mode. Return null when there is nothing to choose (see ConfigStrip in
   * ./shared.tsx for the frame).
   */
  Config?: ComponentType<DashConfigProps<W>>;
  /** A stable instance for live shop previews. Use a fixed `preview-*` id. */
  preview: W;
};

/**
 * A spec for *some* widget, whose type is no longer known. The registry holds
 * one list of eleven differently-typed specs, and `create`/`title`/`Body` all
 * consume `W`, so no honest supertype exists: `DashWidgetSpec<DashWidgetBase>`
 * would reject every real spec. Each spec is precisely typed at its definition
 * (`defineDashWidget` below); this is the shelf they sit on afterwards.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDashWidgetSpec = DashWidgetSpec<any>;

/** Identity helper so a spec infers its widget type from the fields. */
export const defineDashWidget = <W extends DashWidgetBase>(
  spec: DashWidgetSpec<W>,
): DashWidgetSpec<W> => spec;
