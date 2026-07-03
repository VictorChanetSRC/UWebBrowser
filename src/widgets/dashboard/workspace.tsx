import { Compass } from "lucide-react";
import { unreal } from "@/lib/engines";
import { LinkCard, LinkGrid } from "@/components/LinkCard";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import { DataCard } from "./shared";

/** The Unreal working set: docs, Fab, forums and engine source in one grid. */
export type WorkspaceWidget = { id: string; type: "workspace"; span: TileSpan };

function WorkspaceBody({ onOpen }: DashBodyProps<WorkspaceWidget>) {
  return (
    <DataCard label={`${unreal.name} workspace`}>
      <p className="text-ink-400">{unreal.tagline}</p>
      <LinkGrid>
        {unreal.links.map((link) => (
          <LinkCard key={link.url} item={link} onOpen={onOpen} />
        ))}
      </LinkGrid>
    </DataCard>
  );
}

export default defineDashWidget<WorkspaceWidget>({
  type: "workspace",
  icon: Compass,
  creator: VICTOR_CHANET,
  shop: {
    name: "Unreal workspace",
    tagline: "Docs, Fab, forums and engine source in one grid.",
    description:
      "The Unreal working set — documentation, Fab, forums, issue tracker and " +
      "engine source — pinned into one tile so the tools are never a search " +
      "away.",
    category: "tools",
    tags: ["unreal", "docs", "fab", "forums", "github", "links"],
    facts: [
      { label: "Source", value: "Curated links" },
      { label: "Refresh", value: "They're links · always current" },
      { label: "Tile", value: "2×2 to start · resize freely" },
    ],
    repeatable: false,
  },
  defaultSpan: { c: 2, r: 2 },
  create: (base) => ({ ...base, type: "workspace" }),
  title: () => "Unreal workspace",
  Body: WorkspaceBody,
  preview: { id: "preview-workspace", type: "workspace", span: { c: 2, r: 2 } },
});
