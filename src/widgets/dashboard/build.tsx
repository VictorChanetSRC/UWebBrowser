import { useEffect, useState } from "react";
import { Hammer } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc, type EngineInstall } from "@/lib/ipc";
import { makeProject, matchEngine, mergeEngines, projectForGame } from "@/lib/unreal";
import {
  cancelBuildJob,
  jobProgressCaption,
  jobProgressValue,
  jobRunning,
  jobStatusLabel,
  jobVerdictClass,
  packageProject,
} from "@/lib/build-job";
import { elapsedSince } from "@/lib/format";
import { useBuildJob } from "@/hooks/use-build-job";
import { useUnrealState } from "@/hooks/use-unreal-state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/ui/live-dot";
import { Progress } from "@/components/ui/progress";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import { CardLink, DataCard, TileHint, TracksGameConfig, trackedGame } from "./shared";

/**
 * The bridge between a dashboard game and its Unreal project: link the
 * .uproject once, then package and watch the job without leaving here.
 */
export type BuildWidget = {
  id: string;
  type: "build";
  span: TileSpan;
  /** Which setup game to build; null falls back to the first game. */
  gameId: string | null;
};

function BuildBody({ widget, games, active, onUnreal }: DashBodyProps<BuildWidget>) {
  const game = trackedGame(widget.gameId, games);
  const [unrealState, setUnrealState] = useUnrealState();
  const [detected, setDetected] = useState<EngineInstall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const job = useBuildJob();

  // Engine detection scans the disk/registry; only run it for a live tile (the
  // work-bar twin gates the same way), not for an inert shop preview.
  useEffect(() => {
    if (!active) return;
    ipc.detectEngines().then(setDetected).catch(() => {});
  }, [active]);

  const engines = mergeEngines(detected, unrealState.manualEngines);

  const project = game ? projectForGame(unrealState.projects, game) : null;
  const engine = project ? matchEngine(project, engines) : null;

  // A name-matched project becomes a real link so it survives renames.
  useEffect(() => {
    if (!project || !game || project.gameId === game.id) return;
    setUnrealState((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === project.id ? { ...p, gameId: game.id } : p,
      ),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, game?.id]);

  const link = async () => {
    if (!game) return;
    setError(null);
    const picked = await open({
      title: `Pick the .uproject behind ${game.name || "this game"}`,
      filters: [{ name: "Unreal project", extensions: ["uproject"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const info = await ipc.readUproject(picked);
      setUnrealState((prev) => {
        const existing = prev.projects.find(
          (p) => p.uprojectPath.toLowerCase() === picked.toLowerCase(),
        );
        return {
          ...prev,
          projects: existing
            ? prev.projects.map((p) =>
                p.id === existing.id ? { ...p, gameId: game.id } : p,
              )
            : [...prev.projects, makeProject(info, picked, game.id)],
        };
      });
    } catch (e) {
      setError(String(e));
    }
  };

  const unlink = () => {
    if (!project) return;
    setUnrealState((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === project.id ? { ...p, gameId: "" } : p,
      ),
    }));
  };

  const ourJob = job && project && job.projectName === project.name ? job : null;
  const running = ourJob !== null && jobRunning(ourJob);

  const packageGame = () => {
    if (project && engine) packageProject(project, engine);
  };

  return (
    <DataCard
      label="Build"
      links={<CardLink onClick={onUnreal}>Toolbench</CardLink>}
    >
      {!game ? (
        <TileHint>Set up a game first; its Unreal project links here.</TileHint>
      ) : !project ? (
        <>
          <TileHint>
            Link the Unreal project behind {game.name || "this game"} to package it from here.
          </TileHint>
          {error && <p className="text-sm text-ink-300">{error}</p>}
          <div className="flex gap-2.5">
            <Button onClick={link}>Link .uproject</Button>
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold">{project.name}</span>
            <span className="flex-none rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] text-ink-500">
              {engine ? `UE ${engine.version}` : "no engine"}
            </span>
          </div>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-ink-500">
            {project.uprojectPath}
          </span>

          {ourJob && (
            <div className="flex items-center gap-3 text-sm">
              {/* The one Signal moment on this screen: a build in flight. */}
              {running && !ourJob.cancelRequested && <LiveDot />}
              <span className={cn("font-medium", jobVerdictClass(ourJob))}>
                {jobStatusLabel(ourJob)}
              </span>
              <span className="font-mono text-[11.5px] text-ink-500">
                {elapsedSince(ourJob.startedAt)}
              </span>
              {running && (
                <Button size="sm" onClick={cancelBuildJob} disabled={ourJob.cancelRequested}>
                  Cancel
                </Button>
              )}
            </div>
          )}

          {running && ourJob && (
            <div className="flex items-center gap-3">
              <Progress value={jobProgressValue(ourJob) ?? 0} className="max-w-[320px]" />
              <span className="flex-none font-mono text-[11px] tabular-nums text-ink-500">
                {jobProgressCaption(ourJob)}
              </span>
            </div>
          )}

          {error && <p className="text-sm text-ink-300">{error}</p>}

          <div className="mt-auto flex items-center gap-2.5 pt-1">
            <Button
              variant="primary"
              onClick={packageGame}
              disabled={!engine || (job !== null && job.exitCode === null)}
              title={engine ? undefined : "No engine matched. Link one on the toolbench."}
            >
              Package · Win64
            </Button>
            <Button variant="ghost" onClick={unlink}>
              Unlink
            </Button>
          </div>
        </div>
      )}
    </DataCard>
  );
}

export default defineDashWidget<BuildWidget>({
  type: "build",
  icon: Hammer,
  creator: VICTOR_CHANET,
  shop: {
    name: "Build",
    tagline: "Link a .uproject and package Win64 builds without leaving home.",
    description:
      "Point it at a .uproject once and packaging is one click away. Progress, " +
      "elapsed time and cancel live right in the tile, mirroring the Unreal " +
      "toolbench job as it runs.",
    category: "game",
    tags: ["unreal", "package", "uproject", "compile", "win64"],
    facts: [
      { label: "Source", value: "Local Unreal toolbench" },
      { label: "Refresh", value: "Live while a job runs" },
      { label: "Needs", value: "A .uproject on disk" },
      { label: "Tile", value: "2×1 to start · resize freely" },
    ],
    repeatable: false,
  },
  defaultSpan: { c: 2, r: 1 },
  create: (base) => ({ ...base, type: "build", gameId: null }),
  title: () => "Build",
  Body: BuildBody,
  Config: TracksGameConfig,
  preview: { id: "preview-build", type: "build", span: { c: 2, r: 1 }, gameId: null },
});
