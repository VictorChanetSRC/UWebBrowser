import { GitBranch } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { GITHUB_NEW_ISSUE_URL, GITHUB_REPO_URL } from "@/lib/github";
import { feedDate, fmtNumber, MISSING } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import {
  CardLink,
  DataCard,
  FeedRow,
  RowSkeletons,
  Stat,
  StatGrid,
  TileHint,
} from "./shared";

/** The app's own repo: stars, open issues, and the release changelog. */
export type GithubWidget = {
  id: string;
  type: "github";
  span: TileSpan;
};

/** Release notes are markdown; flatten a snippet for a one-line preview. */
function notesSnippet(notes: string): string {
  return notes
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*`>_]/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
    .join(" · ");
}

function GithubBody({ widget, active, onOpen }: DashBodyProps<GithubWidget>) {
  const { data: stats, error: statsError } = usePolled(
    () => ipc.githubRepoStats(),
    [],
    900_000,
    active,
  );
  const { data: releases } = usePolled(
    () => ipc.githubReleases(),
    [],
    1_800_000,
    active,
  );
  const tall = widget.span.r > 1 || widget.span.c > 1;
  const shown = releases?.slice(0, tall ? 5 : 2);

  return (
    <DataCard
      label="UWebBrowser on GitHub"
      error={!stats && statsError ? `GitHub didn't answer: ${statsError}` : null}
      loading={!stats}
      skeleton={<RowSkeletons count={3} />}
      links={
        <>
          <CardLink onClick={() => onOpen(GITHUB_NEW_ISSUE_URL)}>Feedback</CardLink>
          <CardLink onClick={() => onOpen(GITHUB_REPO_URL)}>Open repo</CardLink>
        </>
      }
    >
      <StatGrid>
        <Stat label="Stars" value={stats ? fmtNumber(stats.stars) : MISSING} live />
        <Stat
          label="Open issues"
          value={stats ? fmtNumber(stats.openIssues) : MISSING}
          muted
        />
      </StatGrid>
      {shown && shown.length === 0 && <TileHint>No releases published yet.</TileHint>}
      {shown && shown.length > 0 && (
        <ul className="flex list-none flex-col">
          {shown.map((release, index) => (
            <FeedRow
              key={release.tag}
              index={index}
              onClick={() => onOpen(release.url)}
              className="flex-col gap-1"
            >
              <span className="flex w-full items-baseline justify-between gap-3">
                <span className="truncate text-sm text-ink-200">{release.name}</span>
                {release.published !== null && (
                  <span className="flex-none font-mono text-[11px] text-ink-500">
                    {feedDate(release.published)}
                  </span>
                )}
              </span>
              {index === 0 && release.notes && (
                <span className="line-clamp-2 text-[12px] leading-[1.5] text-ink-400">
                  {notesSnippet(release.notes)}
                </span>
              )}
            </FeedRow>
          ))}
        </ul>
      )}
    </DataCard>
  );
}

export default defineDashWidget<GithubWidget>({
  type: "github",
  icon: GitBranch,
  creator: VICTOR_CHANET,
  shop: {
    name: "UWebBrowser HQ",
    tagline: "The project's pulse: stars, issues and what shipped last.",
    description:
      "Follows the UWebBrowser repository itself — live star count, open " +
      "issues, and the latest release notes. One click to the repo, one " +
      "click to file feedback. Starring is the easiest way to support the " +
      "project.",
    category: "tools",
    tags: ["github", "stars", "releases", "changelog", "feedback", "open source"],
    facts: [
      { label: "Source", value: "GitHub public API" },
      { label: "Refresh", value: "Every 15 min" },
      { label: "Tile", value: "1×2 to start · resize freely" },
    ],
    repeatable: false,
  },
  defaultSpan: { c: 1, r: 2 },
  create: (base) => ({ ...base, type: "github" }),
  title: () => "UWebBrowser HQ",
  Body: GithubBody,
  preview: {
    id: "preview-github",
    type: "github",
    span: { c: 1, r: 2 },
  },
});
