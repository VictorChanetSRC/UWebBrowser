/* ---------------------------------------------------------------------------
   Shared recipes for everything that floats above the page.

   Layer scale — floating surfaces used to pick raw z-index numbers, which left
   dropdowns (z-50) painting above modals (z-40). These five names are the whole
   scale; nothing floating above the page should use a bare `z-*` utility.
   (In-flow stacking — a drag handle over its tile — still uses `z-10` locally.)
--------------------------------------------------------------------------- */

/** Full-content overlays that replace the page: status pages, the DevTools dock. */
export const Z_CONTENT = "z-30";
/** Floating strips anchored to the chrome (find bar), and popover click-away scrims. */
export const Z_STRIP = "z-40";
/** Dropdowns, menus, anchored bubbles — above their scrim, below any modal. */
export const Z_POPOVER = "z-[45]";
/** Modal scrim + card. Blocks the page; only the toast may cover it. */
export const Z_MODAL = "z-50";
/** The toast is an announcement — it outranks everything, including modals. */
export const Z_TOAST = "z-[60]";

/** The dimming layer behind a modal. One opacity + blur for every dialog. */
export const SCRIM_CLASS = "bg-black/50 backdrop-blur-[2px]";

/** The floating surface shared by dropdowns, menus and anchored bubbles. The
 *  brighter `ink-700` edge (vs the dimmer `--border`) is what separates an
 *  interactive popover from an inline card. */
export const POPOVER_SURFACE =
  "rounded-xl border border-ink-700 bg-popover shadow-popover";

/** The lifted card at the center of a modal. Same edge, deeper shadow. */
export const MODAL_SURFACE =
  "animate-rise rounded-xl border border-ink-700 bg-popover shadow-modal";
