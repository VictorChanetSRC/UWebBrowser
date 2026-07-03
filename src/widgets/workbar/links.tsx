import { useState } from "react";
import { Bookmark, X } from "lucide-react";
import type { LinkItem } from "@/lib/engines";
import { hostOf } from "@/lib/url";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Input } from "@/components/ui/input";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps, type BarEditorProps } from "./define";

/** A named list of sites. The toolbar star pins pages into the "Pinned" one. */
export type LinksWidget = {
  id: string;
  type: "links";
  label: string;
  items: LinkItem[];
};

function LinksBody({ widget, onOpen }: BarBodyProps<LinksWidget>) {
  return (
    <div className="flex flex-col gap-0.5">
      {widget.items.map((item) => (
        <button
          key={item.url}
          className="group flex min-w-0 items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-ink-300 transition-[background-color,color] duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100 active:translate-x-px"
          onClick={() => onOpen(item.url)}
          title={item.hint ?? item.url}
        >
          <Favicon
            url={item.url}
            className="size-[15px] rounded-[3px] opacity-70 grayscale transition-[filter,opacity] duration-[130ms] ease-brand group-hover:opacity-100 group-hover:grayscale-0"
          />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- editor ---------------------------------- */

function LinksEditor({ widget, onPatch }: BarEditorProps<LinksWidget>) {
  const addItem = (item: LinkItem) => {
    if (widget.items.some((i) => i.url === item.url)) return;
    onPatch({ items: [...widget.items, item] });
  };
  const removeItem = (url: string) => {
    onPatch({ items: widget.items.filter((i) => i.url !== url) });
  };

  return (
    <div className="flex flex-col gap-0.5 border-t border-border p-2">
      {widget.items.length === 0 && (
        <p className="px-1.5 py-1 text-[12px] leading-[1.5] text-ink-500">
          No links yet. Add one below, or pin any page with the toolbar star.
        </p>
      )}
      {widget.items.map((item) => (
        <div
          key={item.url}
          className="group flex min-w-0 items-center gap-2 rounded-[7px] px-1.5 py-1 transition-[background-color] duration-[130ms] ease-brand hover:bg-ink-800"
        >
          <span className="min-w-0 flex-none overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-ink-200">
            {item.name}
          </span>
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-ink-500">
            {hostOf(item.url)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 flex-none rounded-md text-ink-500"
            onClick={() => removeItem(item.url)}
            aria-label={`Remove ${item.name}`}
          >
            <X className="size-2.5" aria-hidden />
          </Button>
        </div>
      ))}
      <AddLink onAdd={addItem} />
    </div>
  );
}

function AddLink({ onAdd }: { onAdd: (item: LinkItem) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const reset = () => {
    setOpen(false);
    setName("");
    setUrl("");
  };

  const submit = () => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    const full = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
    let fallback: string;
    try {
      fallback = new URL(full).hostname;
    } catch {
      return;
    }
    onAdd({ name: name.trim() || fallback, url: full });
    reset();
  };

  if (!open) {
    return (
      <button
        className="rounded-[7px] px-1.5 py-1 text-left text-[12.5px] text-ink-500 transition-[background-color,color] duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-200"
        onClick={() => setOpen(true)}
      >
        + Add link
      </button>
    );
  }

  const smallInput =
    "h-[30px] min-w-0 flex-1 rounded-md bg-background px-[9px] text-[12.5px] hover:border-ink-700 focus:border-ink-500";

  return (
    <form
      className={cn("mt-0.5 flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-1.5">
        <Input
          autoFocus
          value={name}
          placeholder="Name"
          className={smallInput}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && reset()}
        />
        <Input
          value={url}
          placeholder="example.com"
          spellCheck={false}
          className={smallInput}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && reset()}
        />
      </div>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm">
          Add
        </Button>
        <Button size="sm" className="border-transparent text-ink-400" onClick={reset}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default defineBarWidget<LinksWidget>({
  type: "links",
  icon: Bookmark,
  creator: VICTOR_CHANET,
  shop: {
    name: "Link list",
    tagline: "A named list of sites. The toolbar star pins pages here.",
    description:
      "Your own corner of the rail. Name it, fill it, stack several — docs on " +
      "one, references on another. The toolbar star drops pages into your " +
      "Pinned list.",
    category: "tools",
    tags: ["bookmarks", "pins", "favorites", "sites", "shortcuts"],
    facts: [
      { label: "Source", value: "You · plus the toolbar star" },
      { label: "Refresh", value: "Instant" },
    ],
    repeatable: true,
  },
  create: (base) => ({ ...base, type: "links", label: "Links", items: [] }),
  title: (widget) => widget.label,
  Body: LinksBody,
  Editor: LinksEditor,
  rename: {
    value: (widget) => widget.label,
    patch: (label) => ({ label }),
  },
  preview: {
    id: "preview-links",
    type: "links",
    label: "Pinned",
    items: [
      { name: "Unreal Engine docs", url: "https://dev.epicgames.com/documentation" },
      { name: "Fab", url: "https://www.fab.com" },
      { name: "r/unrealengine", url: "https://www.reddit.com/r/unrealengine/" },
    ],
  },
});
