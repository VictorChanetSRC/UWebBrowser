import { useState } from "react";
import { Hammer } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { matchEngine, type UnrealProject } from "@/lib/unreal";
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
import { useEngines } from "@/hooks/use-engines";
import { useUnrealState } from "@/hooks/use-unreal-state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/ui/live-dot";
import { Progress } from "@/components/ui/progress";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps, type BarEditorProps } from "./define";
import { ChipRow, WidgetCard, WidgetHint } from "./shared";

/** The Unreal build in flight — start one, watch it, or open the editor. */
export type BuildWidget = {
  id: string;
  type: "build";
  /** Which linked project to build; empty falls back to the first one. */
  projectId?: string;
};

/** The project this widget acts on: the chosen one, else the first linked. */
function trackedProject(
  widget: BuildWidget,
  projects: UnrealProject[],
): UnrealProject | null {
  return projects.find((p) => p.id === widget.projectId) ?? projects[0] ?? null;
}

function BuildBody({ widget, active, onUnreal }: BarBodyProps<BuildWidget>) {
  const job = useBuildJob();
  const [unrealState] = useUnrealState();
  const [error, setError] = useState<string | null>(null);

  const engines = useEngines(active, unrealState.manualEngines);
  const project = trackedProject(widget, unrealState.projects);
  const engine = project ? matchEngine(project, engines) : null;
  const running = job !== null && jobRunning(job);

  const packageGame = () => {
    if (!project || !engine) return;
    setError(null);
    packageProject(project, engine);
  };

  const openEditor = async () => {
    if (!project) return;
    setError(null);
    try {
      await ipc.openUproject(project.uprojectPath, engine?.path ?? null);
    } catch (e) {
      setError(String(e));
    }
  };

  if (!job && !project) {
    return (
      <WidgetCard onClick={onUnreal} title="Open the Unreal toolbench">
        <WidgetHint>No project linked. Link a .uproject on the toolbench.</WidgetHint>
      </WidgetCard>
    );
  }

  // Package + open-editor, shown whenever a build could start right now.
  const actions = !running && project && (
    <div className="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        className="h-6 px-2 text-[11px]"
        onClick={packageGame}
        disabled={!engine}
        title={engine ? "Package · Development · Win64" : "No engine matched. Link one on the toolbench."}
      >
        Package
      </Button>
      <Button size="sm" className="h-6 px-2 text-[11px]" onClick={openEditor}>
        Open editor
      </Button>
    </div>
  );

  if (!job) {
    return (
      <WidgetCard>
        <div
          className="truncate text-[13px] font-semibold text-ink-100"
          title={project!.uprojectPath}
        >
          {project!.name}
        </div>
        <span className="font-mono text-[11px] text-ink-500">
          {engine ? `UE ${engine.version} · Win64` : "No engine matched"}
        </span>
        {error && <WidgetHint>{error}</WidgetHint>}
        {actions}
      </WidgetCard>
    );
  }

  const progress = jobProgressValue(job);
  const caption = jobProgressCaption(job);

  return (
    <WidgetCard>
      <div className="truncate text-[13px] font-semibold text-ink-100">
        {job.projectName}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {/* The one Signal moment on the work bar: a build in flight. */}
        {running && !job.cancelRequested && <LiveDot />}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12px]",
            running || job.cancelRequested
              ? "text-ink-300"
              : cn("font-medium", jobVerdictClass(job)),
          )}
        >
          {jobStatusLabel(job)}
        </span>
        <span className="flex-none font-mono text-[11px] tabular-nums text-ink-500">
          {elapsedSince(job.startedAt)}
        </span>
      </div>
      {running && (
        <div className="flex flex-col gap-1">
          {progress !== null && <Progress value={progress} />}
          {caption && (
            <span className="font-mono text-[10.5px] tabular-nums text-ink-500">{caption}</span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button variant="link" size="none" className="text-[12px] font-normal" onClick={onUnreal}>
          View log
        </Button>
        {running && (
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={cancelBuildJob}
            disabled={job.cancelRequested}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && <WidgetHint>{error}</WidgetHint>}
      {actions}
    </WidgetCard>
  );
}

/** Project picker on the work bar page; hidden until there's a real choice. */
function BuildEditor({ widget, onPatch }: BarEditorProps<BuildWidget>) {
  const [unrealState] = useUnrealState();
  if (unrealState.projects.length < 2) return null;
  const selected = trackedProject(widget, unrealState.projects);
  return (
    <ChipRow
      className="border-t border-border p-2.5 pl-3.5"
      label="Builds"
      options={unrealState.projects.map((project) => ({ key: project.id, label: project.name }))}
      selected={selected?.id ?? null}
      onPick={(projectId) => onPatch({ projectId })}
    />
  );
}

export default defineBarWidget<BuildWidget>({
  type: "build",
  icon: Hammer,
  creator: VICTOR_CHANET,
  shop: {
    name: "Build status",
    tagline: "Package the game or open the editor, right from the rail.",
    description:
      "Kick off a Win64 package or jump into the Unreal editor without leaving " +
      "the page you're on. While a build runs, progress, elapsed time and a " +
      "cancel button are one glance away.",
    category: "game",
    tags: ["unreal", "package", "uproject", "compile", "progress", "editor"],
    facts: [
      { label: "Source", value: "Local Unreal toolbench" },
      { label: "Refresh", value: "Live while a job runs" },
      { label: "Needs", value: "A .uproject on disk" },
    ],
    repeatable: false,
  },
  create: (base) => ({ ...base, type: "build", projectId: "" }),
  title: () => "Build",
  Body: BuildBody,
  Editor: BuildEditor,
  preview: { id: "preview-build", type: "build" },
});
