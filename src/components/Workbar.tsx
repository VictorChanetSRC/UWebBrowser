import { useState } from "react";
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
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { PageShell } from "@/components/ui/page-shell";

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

  return (
    <>
      <PageShell width="max-w-[880px]">
          <PageHeader
            kicker="Work bar"
            title="Build your work bar."
            description="Widgets ride along in the side rail while you browse. Pick them up in the widget shop — every one previews live — then order and tune them here."
            actions={
              <div className="flex gap-2.5">
                <Button variant="primary" onClick={() => setShopOpen(true)}>
                  <Store className="size-3.5" aria-hidden />
                  Browse widgets
                </Button>
                <ConfirmButton
                  variant="ghost"
                  confirmLabel="Click again to reset"
                  onConfirm={() => onChange(seedWidgets())}
                >
                  Reset to defaults
                </ConfirmButton>
              </div>
            }
          />

          <Section label={`On your bar · ${widgets.length}`} className="min-w-0">
            {widgets.length === 0 ? (
              <EmptyState title="Nothing on the bar. The widget shop has the goods.">
                <Button onClick={() => setShopOpen(true)}>
                  <Store className="size-3.5" aria-hidden />
                  Browse widgets
                </Button>
              </EmptyState>
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
      </PageShell>

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
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-200">
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
