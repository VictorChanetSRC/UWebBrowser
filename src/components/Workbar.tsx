import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Store, X } from "lucide-react";
import type { Game } from "../lib/config";
import {
  addWidget,
  moveWidget,
  removeWidget,
  seedWidgets,
  updateWidget,
  type Widget,
} from "../lib/workbar";
import { BAR_SPECS, BarWidgetEditor, barWidgetTitle } from "@/widgets/workbar";
import { WorkbarShop } from "./WidgetShop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";

type Props = {
  widgets: Widget[];
  games: Game[];
  itchApiKey: string;
  onChange: (widgets: Widget[]) => void;
  /** Opens a URL in a browser tab (author links in the widget shop). */
  onOpen: (url: string) => void;
};

export function Workbar({ widgets, games, itchApiKey, onChange, onOpen }: Props) {
  const [shopOpen, setShopOpen] = useState(false);

  const [confirmReset, setConfirmReset] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    onChange(seedWidgets());
  };

  return (
    <>
      <div className="absolute inset-0 @container overflow-y-auto">
        <div className="mx-auto flex max-w-[880px] animate-rise flex-col gap-9 px-10 pb-20 pt-14">
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <Label>Work bar</Label>
              <h1 className="my-2.5 text-[40px] font-semibold leading-[1.1] tracking-[-0.025em]">
                Build your work bar.
              </h1>
              <p className="max-w-[60ch] text-ink-400">
                Widgets ride along in the side rail while you browse. Pick them
                up in the widget shop — every one previews live — then order and
                tune them here.
              </p>
            </div>
            <div className="flex gap-2.5">
              <Button variant="primary" onClick={() => setShopOpen(true)}>
                <Store className="size-3.5" aria-hidden />
                Browse widgets
              </Button>
              <Button variant="ghost" onClick={reset}>
                {confirmReset ? "Click again to reset" : "Reset to defaults"}
              </Button>
            </div>
          </header>

          <Section label={`On your bar · ${widgets.length}`} className="min-w-0">
            {widgets.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-ink-700 px-6 py-10 text-center text-ink-400">
                <p>Nothing on the bar. The widget shop has the goods.</p>
                <Button onClick={() => setShopOpen(true)}>
                  <Store className="size-3.5" aria-hidden />
                  Browse widgets
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {widgets.map((widget, index) => (
                  <BarRow
                    key={widget.id}
                    widget={widget}
                    index={index}
                    first={index === 0}
                    last={index === widgets.length - 1}
                    games={games}
                    onMove={(dir) => onChange(moveWidget(widgets, widget.id, dir))}
                    onRemove={() => onChange(removeWidget(widgets, widget.id))}
                    onPatch={(patch) => onChange(updateWidget(widgets, widget.id, patch))}
                  />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      <WorkbarShop
        open={shopOpen}
        onClose={() => setShopOpen(false)}
        widgets={widgets}
        games={games}
        itchApiKey={itchApiKey}
        onAdd={(type) => onChange(addWidget(widgets, type))}
        onOpenUrl={onOpen}
      />
    </>
  );
}

/* ------------------------------- bar editor ------------------------------- */

/**
 * One widget on the bar: shared chrome (order, remove) up top, then whatever
 * the widget's spec brings — an in-place rename when it declares one, and its
 * own editor section below (link lists, game pickers).
 */
function BarRow({
  widget,
  index,
  first,
  last,
  games,
  onMove,
  onRemove,
  onPatch,
}: {
  widget: Widget;
  index: number;
  first: boolean;
  last: boolean;
  games: Game[];
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onPatch: (patch: Partial<Widget>) => void;
}) {
  const spec = BAR_SPECS[widget.type];
  const Icon = spec.icon;
  const control = "size-6 flex-none rounded-md text-ink-500";

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-ink-900">
      <div className="flex items-center gap-2 py-2 pl-3.5 pr-2">
        <span className="w-5 flex-none font-mono text-[10.5px] tabular-nums text-ink-500">
          {String(index + 1).padStart(2, "0")}
        </span>
        <Icon className="size-3.5 flex-none text-ink-400" aria-hidden />
        {spec.rename ? (
          <Input
            value={spec.rename.value(widget)}
            aria-label={`Rename ${spec.shop.name}`}
            className="h-6 min-w-0 flex-1 rounded-md border-transparent bg-transparent px-1.5 text-[13px] font-medium text-ink-200 hover:border-ink-700 focus:border-ink-500"
            onChange={(e) => onPatch(spec.rename!.patch(e.target.value))}
          />
        ) : (
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-ink-200">
            {barWidgetTitle(widget)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={control}
          disabled={first}
          onClick={() => onMove(-1)}
          aria-label="Move widget up"
        >
          <ChevronUp className="size-3" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={control}
          disabled={last}
          onClick={() => onMove(1)}
          aria-label="Move widget down"
        >
          <ChevronDown className="size-3" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={control}
          onClick={onRemove}
          aria-label={`Remove ${barWidgetTitle(widget)}`}
        >
          <X className="size-2.5" aria-hidden />
        </Button>
      </div>

      <BarWidgetEditor widget={widget} games={games} onPatch={onPatch} />
    </article>
  );
}
