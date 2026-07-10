import { memo } from "react";
import { Compass } from "lucide-react";
import type { Game } from "../lib/config";
import type { Widget } from "../lib/workbar";
import { BarWidgetBody, barWidgetTitle } from "@/widgets/workbar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label, labelVariants } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
    <aside className="flex h-full w-full flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between px-[18px] pb-1 pt-3.5">
        <Label size="micro">Work bar</Label>
        <Button
          variant="ghost"
          size="none"
          className={cn(labelVariants({ size: "micro" }), "rounded-md px-[7px] py-[3px]")}
          onClick={onCustomize}
        >
          Customize
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-2.5 pb-4 pt-3">
        {shown.map((widget) => (
          <section key={widget.id} className="flex flex-col gap-1">
            <Label size="micro" className="min-w-0 truncate px-2 pb-1">
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
          <EmptyState variant="compact" title="The bar is empty. Add live status and link widgets.">
            <Button size="sm" onClick={onCustomize}>
              Browse widgets
            </Button>
          </EmptyState>
        )}
      </div>

      <div className="border-t border-border p-2.5">
        <Button
          variant="ghost"
          size="none"
          className="group w-full justify-start gap-2.5 rounded-[7px] p-2 text-[13px] font-medium text-ink-300"
          onClick={onDiscover}
        >
          <Compass
            className="size-3.5 text-ink-500 transition-[color] duration-[130ms] ease-brand group-hover:text-ink-200"
            aria-hidden
          />
          <span>Discover</span>
        </Button>
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarImpl);
