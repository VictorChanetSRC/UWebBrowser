import { memo } from "react";
import { Compass } from "lucide-react";
import type { Game } from "../lib/config";
import type { Widget } from "../lib/workbar";
import { BarWidgetBody, barWidgetTitle } from "@/widgets/workbar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Props = {
  widgets: Widget[];
  games: Game[];
  itchApiKey: string;
  active?: boolean;
  onOpen: (url: string) => void;
  onDiscover: () => void;
  onUnreal: () => void;
  /** Opens the uwb://workbar page, where all widget editing lives. */
  onCustomize: () => void;
};

/** Empty link lists stay out of the way until you fill them on the work bar page. */
const visible = (widget: Widget) => widget.type !== "links" || widget.items.length > 0;

function SidebarImpl({
  widgets,
  games,
  itchApiKey,
  active = true,
  onOpen,
  onDiscover,
  onUnreal,
  onCustomize,
}: Props) {
  const shown = widgets.filter(visible);

  return (
    <aside className="flex w-[240px] flex-none flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between px-[18px] pb-1 pt-3.5">
        <Label className="text-[10.5px]">Work bar</Label>
        <button
          className="rounded-md px-[7px] py-[3px] font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-500 transition-[background-color,color] duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100"
          onClick={onCustomize}
        >
          Customize
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-2.5 pb-4 pt-3">
        {shown.map((widget) => (
          <section key={widget.id} className="flex flex-col gap-1">
            <Label className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-2 pb-1 text-[10.5px]">
              {barWidgetTitle(widget)}
            </Label>
            <BarWidgetBody
              widget={widget}
              games={games}
              itchApiKey={itchApiKey}
              active={active}
              onOpen={onOpen}
              onUnreal={onUnreal}
            />
          </section>
        ))}

        {shown.length === 0 && (
          <div className="flex flex-col items-start gap-2.5 rounded-[10px] border border-dashed border-ink-700 p-3">
            <p className="text-[12px] leading-[1.5] text-ink-400">
              The bar is empty. Add live status and link widgets.
            </p>
            <Button size="sm" onClick={onCustomize}>
              Browse widgets
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-border p-2.5">
        <button
          className="group flex w-full items-center gap-2.5 rounded-[7px] p-2 text-[13px] font-medium text-ink-300 transition-[background-color,color] duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100"
          onClick={onDiscover}
        >
          <Compass
            className="size-3.5 text-ink-500 transition-[color] duration-[130ms] ease-brand group-hover:text-ink-200"
            aria-hidden
          />
          <span>Discover</span>
        </button>
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarImpl);
