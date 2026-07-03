import { Hammer } from "lucide-react";
import {
  cancelBuildJob,
  jobProgressCaption,
  jobProgressValue,
  jobRunning,
  jobStatusLabel,
} from "@/lib/build-job";
import { elapsedSince } from "@/lib/format";
import { useBuildJob } from "@/hooks/use-build-job";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/ui/live-dot";
import { Progress } from "@/components/ui/progress";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { WidgetCard, WidgetHint } from "./shared";

/** The Unreal build in flight, with progress and cancel. */
export type BuildWidget = { id: string; type: "build" };

function BuildBody({ onUnreal }: BarBodyProps<BuildWidget>) {
  const job = useBuildJob();

  if (!job) {
    return (
      <WidgetCard onClick={onUnreal} title="Open the Unreal toolbench">
        <WidgetHint>Nothing building. Kick one off from the toolbench.</WidgetHint>
      </WidgetCard>
    );
  }

  const running = jobRunning(job);
  const progress = jobProgressValue(job);
  const caption = jobProgressCaption(job);

  return (
    <WidgetCard>
      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-ink-100">
        {job.projectName}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {/* The one Signal moment on the work bar: a build in flight. */}
        {running && !job.cancelRequested && <LiveDot />}
        <span
          className={cn(
            "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px]",
            !running && job.exitCode !== 0 && !job.cancelRequested
              ? "font-medium text-signal-400"
              : !running && job.exitCode === 0
                ? "font-medium text-ink-100"
                : "text-ink-300",
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
    </WidgetCard>
  );
}

export default defineBarWidget<BuildWidget>({
  type: "build",
  icon: Hammer,
  creator: VICTOR_CHANET,
  shop: {
    name: "Build status",
    tagline: "The Unreal build in flight, with progress and cancel.",
    description:
      "Kick off a package from the Unreal hub and watch it land from anywhere. " +
      "Progress, elapsed time and a cancel button, one glance away.",
    category: "game",
    tags: ["unreal", "package", "uproject", "compile", "progress"],
    facts: [
      { label: "Source", value: "Local Unreal toolbench" },
      { label: "Refresh", value: "Live while a job runs" },
      { label: "Needs", value: "A .uproject on disk" },
    ],
    repeatable: false,
  },
  create: (base) => ({ ...base, type: "build" }),
  title: () => "Build",
  Body: BuildBody,
  preview: { id: "preview-build", type: "build" },
});
