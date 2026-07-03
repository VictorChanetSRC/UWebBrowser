import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { Game } from "@/lib/config";
import type { WidgetAuthor, WidgetShopInfo } from "../types";

/**
 * The contract for a work bar widget — the rail that rides along the side
 * while you browse. One spec object holds everything the app needs: stored
 * shape, shop listing, icon, live body, and the optional row editor shown
 * on the work bar page. Register specs in ./index.tsx; the full walkthrough
 * is in docs/WIDGETS.md.
 */

/**
 * What every stored work bar widget carries. A widget's own instance type
 * extends this with a literal `type` and whatever settings it persists —
 * settings only; live data is fetched by the body, never stored.
 */
export type BarWidgetBase = { id: string; type: string };

/** What the surfaces hand every widget body, with `widget` narrowed. */
export type BarBodyProps<W extends BarWidgetBase = BarWidgetBase> = {
  widget: W;
  games: Game[];
  itchApiKey: string;
  /** Gates polling; false when the sidebar is collapsed or hidden. */
  active: boolean;
  onOpen: (url: string) => void;
  onUnreal: () => void;
};

/** Props for a widget's row editor on the work bar page. */
export type BarEditorProps<W extends BarWidgetBase = BarWidgetBase> = {
  widget: W;
  games: Game[];
  onPatch: (patch: Partial<W>) => void;
};

/**
 * Everything the app needs to know about one work bar widget. Build one
 * with {@link defineBarWidget} and register it in ./index.tsx.
 */
export type BarWidgetSpec<W extends BarWidgetBase = BarWidgetBase> = {
  /** The discriminant; must match the instance type's `type` literal. */
  type: W["type"];
  icon: LucideIcon;
  /** Your author profile; powers the credit and your author page in the
   *  shop. Define it once and reuse it — see src/widgets/authors.ts. */
  creator: WidgetAuthor;
  /** The shop listing. */
  shop: WidgetShopInfo;
  /** Build a fresh instance; `base` carries a new id. */
  create: (base: { id: string }) => W;
  /** The title shown on the sidebar card and the work bar page row. */
  title: (widget: W) => string;
  /** The live body, rendered at the rail's 220px width. Gate on `active`. */
  Body: ComponentType<BarBodyProps<W>>;
  /**
   * Optional editor rendered under the widget's row on the work bar page —
   * the place for pickers and item lists (see links/steam for examples).
   * Return null when there is nothing to edit right now.
   */
  Editor?: ComponentType<BarEditorProps<W>>;
  /**
   * Present when the row title is user-editable in place. `value` reads the
   * current label off the widget; `patch` turns a typed label into a patch.
   */
  rename?: {
    value: (widget: W) => string;
    patch: (label: string) => Partial<W>;
  };
  /** A stable instance for live shop previews. Use a fixed `preview-*` id. */
  preview: W;
};

/** Identity helper so a spec infers its widget type from the fields. */
export const defineBarWidget = <W extends BarWidgetBase>(
  spec: BarWidgetSpec<W>,
): BarWidgetSpec<W> => spec;
