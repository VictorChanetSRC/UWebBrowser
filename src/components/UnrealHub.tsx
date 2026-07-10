import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Ban, Check, CheckCircle2, Copy, FolderOpen, Play, X, XCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ipc,
  type BuildAction,
  type BuildLogLine,
  type BuildRecord,
  type EngineInstall,
} from "../lib/ipc";
import type { Game } from "../lib/config";
import {
  makeProject,
  matchEngine,
  mergeEngines,
  type UnrealProject,
} from "../lib/unreal";
import {
  buildJobRunning,
  cancelBuildJob,
  clearBuildJob,
  jobProgressCaption,
  jobProgressValue,
  jobRunning,
  jobStatusLabel,
  startBuildJob,
  type BuildJob,
} from "../lib/build-job";
import { pickById } from "@/lib/list-ops";
import { useAsync } from "@/hooks/use-async";
import { useBuildJob } from "@/hooks/use-build-job";
import { useUnrealState } from "@/hooks/use-unreal-state";
import { usePolled } from "@/hooks/use-polled";
import { useTimedFlag } from "@/hooks/use-timed-flag";
import { elapsedSince, fmtNumber, formatDuration, gb, MISSING } from "@/lib/format";
import { copyText } from "@/lib/url";
import { DashSection, Stat, StatGrid } from "./Dashboard";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import { LiveDot } from "@/components/ui/live-dot";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/page-shell";

const ACTIONS: { key: BuildAction; label: string }[] = [
  { key: "build", label: "Build editor" },
  { key: "cook", label: "Cook content" },
  { key: "package", label: "Package game" },
];
const CONFIGS = ["Development", "DebugGame", "Shipping"];
const PLATFORMS = ["Win64", "Linux", "Android"];
const PACKAGE_STAGES = ["Build", "Cook", "Stage", "Package", "Archive"];

const SOURCE_LABEL: Record<EngineInstall["source"], string> = {
  launcher: "Launcher",
  source: "Source build",
  manual: "Linked",
};

export function UnrealHub({ games }: { games: Game[] }) {
  const [state, update] = useUnrealState();
  const [detected, setDetected] = useState<EngineInstall[]>([]);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      setDetected(await ipc.detectEngines());
    } catch (error) {
      setNotice(`Engine scan failed: ${error}`);
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    rescan();
  }, [rescan]);

  const engines = mergeEngines(detected, state.manualEngines);

  const linkEngine = async () => {
    setNotice(null);
    const picked = await open({ directory: true, title: "Pick an Unreal Engine folder" });
    if (typeof picked !== "string") return;
    try {
      const engine = await ipc.validateEngine(picked);
      update((s) => ({
        ...s,
        manualEngines: [
          ...s.manualEngines.filter(
            (e) => e.path.toLowerCase() !== engine.path.toLowerCase(),
          ),
          engine,
        ],
      }));
    } catch (error) {
      setNotice(String(error));
    }
  };

  const linkProject = async () => {
    setNotice(null);
    const picked = await open({
      title: "Pick a .uproject file",
      filters: [{ name: "Unreal project", extensions: ["uproject"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const info = await ipc.readUproject(picked);
      update((s) => {
        if (
          s.projects.some(
            (p) => p.uprojectPath.toLowerCase() === picked.toLowerCase(),
          )
        ) {
          return s;
        }
        return { ...s, projects: [...s.projects, makeProject(info, picked)] };
      });
    } catch (error) {
      setNotice(String(error));
    }
  };

  const removeEngine = (id: string) =>
    update((s) => ({
      ...s,
      manualEngines: s.manualEngines.filter((e) => e.id !== id),
    }));

  const removeProject = (id: string) =>
    update((s) => ({ ...s, projects: s.projects.filter((p) => p.id !== id) }));

  const setProjectEngine = (id: string, engineId: string) =>
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === id ? { ...p, engineId } : p)),
    }));

  const setProjectGame = (id: string, gameId: string) =>
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === id ? { ...p, gameId } : p)),
    }));

  const setProjectArchiveDir = (id: string, archiveDir: string) =>
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === id ? { ...p, archiveDir } : p)),
    }));

  return (
    <PageShell width="max-w-[1460px]">
        <PageHeader
          kicker="Unreal toolbench"
          title="Build without leaving."
          description="Link your engines and projects once. Package, cook and compile from here, and keep an eye on the machine while it works."
        />

        {notice && <p className="text-sm text-ink-300">{notice}</p>}

        {/* Wide windows keep the machine monitor pinned beside the pipeline,
            so sensors stay in view while a build runs. */}
        <div className="grid gap-x-12 gap-y-9 @5xl:grid-cols-[minmax(0,1fr)_360px] @5xl:items-start">
          <div className="flex min-w-0 flex-col gap-9">
        <DashSection label="Engines">
          {engines.length === 0 && !scanning && (
            <EmptyState>
              No engines yet. Rescan looks at the Epic launcher and registered
              source builds, or link a folder yourself.
            </EmptyState>
          )}
          <div className="flex flex-col">
            {engines.map((engine, index) => (
              <Row key={engine.id} first={index === 0}>
                <span className="w-14 flex-none font-semibold tabular-nums">
                  {engine.version}
                </span>
                <Tag>{SOURCE_LABEL[engine.source]}</Tag>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-500">
                  {engine.path}
                </span>
                {engine.source === "manual" && (
                  <RemoveButton
                    label={`Unlink engine ${engine.version}`}
                    onClick={() => removeEngine(engine.id)}
                  />
                )}
              </Row>
            ))}
          </div>
          <div className="flex gap-2.5">
            <Button onClick={rescan} disabled={scanning}>
              {scanning ? "Scanning…" : "Rescan"}
            </Button>
            <Button onClick={linkEngine}>Link engine folder</Button>
          </div>
        </DashSection>

        <DashSection label="Projects">
          {state.projects.length === 0 && (
            <EmptyState>
              Link a .uproject and it gets matched to the right engine
              automatically.
            </EmptyState>
          )}
          <div className="flex flex-col">
            {state.projects.map((project, index) => {
              const matched = matchEngine(project, engines);
              return (
                <Row key={project.id} first={index === 0}>
                  <span className="min-w-0 flex-none font-semibold">
                    {project.name}
                  </span>
                  {project.engineAssociation && (
                    <Tag>UE {project.engineAssociation}</Tag>
                  )}
                  {!project.hasCode && <Tag>Blueprint only</Tag>}
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-500">
                    {project.uprojectPath}
                  </span>
                  {games.length > 0 && (
                    <Select
                      value={project.gameId}
                      options={[
                        { value: "", label: "No game" },
                        ...games.map((g) => ({
                          value: g.id,
                          label: g.name || "Untitled",
                        })),
                      ]}
                      onChange={(v) => setProjectGame(project.id, v)}
                      ariaLabel={`Game for ${project.name}`}
                    />
                  )}
                  <Select
                    value={project.engineId}
                    options={[
                      { value: "", label: `Auto${matched ? ` · ${matched.version}` : ""}` },
                      ...engines.map((engine) => ({
                        value: engine.id,
                        label: `${engine.version} · ${SOURCE_LABEL[engine.source]}`,
                      })),
                    ]}
                    onChange={(v) => setProjectEngine(project.id, v)}
                    ariaLabel={`Engine for ${project.name}`}
                  />
                  <RemoveButton
                    label={`Unlink ${project.name}`}
                    onClick={() => removeProject(project.id)}
                  />
                </Row>
              );
            })}
          </div>
          <div className="flex gap-2.5">
            <Button onClick={linkProject}>Link .uproject</Button>
          </div>
        </DashSection>

            <BuildSection
              projects={state.projects}
              engines={engines}
              onSetArchiveDir={setProjectArchiveDir}
            />

            <HistorySection />
          </div>

          <aside className="flex min-w-0 flex-col gap-9 @5xl:sticky @5xl:top-10">
            <MachineSection />
          </aside>
        </div>
    </PageShell>
  );
}

function BuildSection({
  projects,
  engines,
  onSetArchiveDir,
}: {
  projects: UnrealProject[];
  engines: EngineInstall[];
  onSetArchiveDir: (projectId: string, archiveDir: string) => void;
}) {
  const job = useBuildJob();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [action, setAction] = useState<BuildAction>("package");
  const [config, setConfig] = useState("Development");
  const [platform, setPlatform] = useState("Win64");

  const project = pickById(projects, projectId);
  const engine = project ? matchEngine(project, engines) : null;
  const running = job !== null && jobRunning(job);

  const run = () => {
    if (!project || !engine || buildJobRunning()) return;
    startBuildJob(project.name, {
      enginePath: engine.path,
      uproject: project.uprojectPath,
      action,
      config,
      platform,
      archiveDir: project.archiveDir || undefined,
    });
  };

  const pickArchiveDir = async () => {
    if (!project) return;
    const picked = await open({
      directory: true,
      title: `Where should packaged ${project.name} builds land?`,
    });
    if (typeof picked === "string") onSetArchiveDir(project.id, picked);
  };

  return (
    <DashSection label="Build & package">
      {projects.length === 0 ? (
        <EmptyState>Link a project above to start building.</EmptyState>
      ) : (
        <>
          <ChipRow label="Project">
            {projects.map((p) => (
              <Button
                key={p.id}
                variant="chip"
                size="chip"
                aria-pressed={p.id === project?.id}
                onClick={() => setProjectId(p.id)}
              >
                {p.name}
              </Button>
            ))}
          </ChipRow>
          <ChipRow label="Action">
            {ACTIONS.map((a) => (
              <Button
                key={a.key}
                variant="chip"
                size="chip"
                aria-pressed={a.key === action}
                disabled={a.key === "build" && project !== null && !project.hasCode}
                title={
                  a.key === "build" && project && !project.hasCode
                    ? "Blueprint-only project. Nothing to compile"
                    : undefined
                }
                onClick={() => setAction(a.key)}
              >
                {a.label}
              </Button>
            ))}
          </ChipRow>
          <ChipRow label="Config">
            {CONFIGS.map((c) => (
              <Button
                key={c}
                variant="chip"
                size="chip"
                aria-pressed={c === config}
                onClick={() => setConfig(c)}
              >
                {c}
              </Button>
            ))}
          </ChipRow>
          {action !== "build" && (
            <ChipRow label="Platform">
              {PLATFORMS.map((p) => (
                <Button
                  key={p}
                  variant="chip"
                  size="chip"
                  aria-pressed={p === platform}
                  onClick={() => setPlatform(p)}
                >
                  {p}
                </Button>
              ))}
            </ChipRow>
          )}
          <div className="flex items-center gap-4 pt-1">
            <Button variant="primary" onClick={run} disabled={!engine || running}>
              {running ? "Working…" : "Run"}
            </Button>
            <span className="font-mono text-[11.5px] text-ink-500">
              {engine
                ? `Engine ${engine.version} · ${engine.path}`
                : "No engine matched. Link one above."}
            </span>
          </div>
          {action === "package" && project && (
            <div className="flex items-center gap-2.5">
              <Label size="micro" className="w-[72px] flex-none">Output</Label>
              <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-500">
                {project.archiveDir || `${project.dir}\\Packaged\\${platform}`}
              </span>
              <Button size="sm" className="flex-none" onClick={pickArchiveDir}>
                Change…
              </Button>
              {project.archiveDir && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-none"
                  onClick={() => onSetArchiveDir(project.id, "")}
                >
                  Use default
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {job && <JobPanel job={job} />}
    </DashSection>
  );
}

function JobPanel({ job }: { job: BuildJob }) {
  const running = jobRunning(job);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [job]);

  const stages = job.action === "package" ? PACKAGE_STAGES : [];
  const stageIndex = stages.indexOf(job.stage);

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-background p-4">
      <div className="flex items-center gap-3">
        {/* The one Signal moment on this screen: a build in flight. */}
        {running && !job.cancelRequested && <LiveDot />}
        {!running &&
          (job.exitCode === 0 ? (
            <CheckCircle2 className="size-4 flex-none text-ink-200" aria-hidden />
          ) : job.cancelRequested ? (
            <Ban className="size-4 flex-none text-ink-400" aria-hidden />
          ) : (
            <XCircle className="size-4 flex-none text-signal-400" aria-hidden />
          ))}
        <span
          className={cn(
            "font-semibold",
            !running &&
              (job.exitCode === 0
                ? "text-ink-100"
                : job.cancelRequested
                  ? "text-ink-400"
                  : "text-signal-400"),
          )}
        >
          {jobStatusLabel(job)}
        </span>
        <span className="font-mono text-[11.5px] text-ink-500">
          {job.projectName} · {ACTIONS.find((a) => a.key === job.action)?.label} ·{" "}
          {elapsedSince(job.startedAt)}
          {job.warnings > 0 && ` · ${fmtNumber(job.warnings)} warnings`}
        </span>
        {job.errors > 0 && (
          <span className="font-mono text-[11.5px] text-signal-400">
            {fmtNumber(job.errors)} errors
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {running ? (
            <Button size="sm" onClick={cancelBuildJob} disabled={job.cancelRequested}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={clearBuildJob}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {stages.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          {stages.map((stage, index) => (
            <span
              key={stage}
              className={cn(
                "rounded-full border border-border px-2 py-0.5",
                index < stageIndex && "text-ink-300",
                index === stageIndex && "border-ink-400 text-ink-100",
                index > stageIndex && "text-ink-400",
              )}
            >
              {stage}
            </span>
          ))}
        </div>
      )}

      {running && (
        <div className="flex items-center gap-3">
          <Progress value={jobProgressValue(job) ?? 0} className="flex-1" />
          <span className="flex-none font-mono text-[11px] tabular-nums text-ink-500">
            {jobProgressCaption(job)}
          </span>
        </div>
      )}

      <div
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current =
            el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
        }}
        className="h-[300px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-ink-900 p-3 font-mono text-[11.5px] leading-[1.55] text-ink-400 select-text"
      >
        {job.lines.length === 0 ? "Waiting for output…" : job.lines.join("\n")}
      </div>
    </div>
  );
}

const formatWhen = (epochMs: number): string =>
  new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Ink shades for the stage breakdown bar, dark to light along the pipeline. */
const STAGE_SHADES: Record<string, string> = {
  Prep: "bg-ink-800",
  Build: "bg-ink-600",
  Cook: "bg-ink-500",
  Stage: "bg-ink-400",
  Package: "bg-ink-300",
  Archive: "bg-ink-200",
};

function HistorySection() {
  const job = useBuildJob();
  // Reload when the running job settles — its record is on disk by then — and
  // when a clear bumps `version`.
  const finishedJobId = job !== null && !jobRunning(job) ? job.id : null;
  const [version, setVersion] = useState(0);
  const { data: records } = useAsync(
    () => ipc.buildHistory().catch(() => [] as BuildRecord[]),
    [finishedJobId, version],
  );
  const [issuesOpen, setIssuesOpen] = useState<{ id: string; sev: 1 | 2 } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const play = async (record: BuildRecord) => {
    setNotice(null);
    if (!record.archiveDir) return;
    try {
      const exe = await ipc.launchPackaged(record.archiveDir, record.project);
      setNotice(`Launched ${exe}`);
    } catch (error) {
      setNotice(String(error));
    }
  };

  const reveal = async (record: BuildRecord) => {
    setNotice(null);
    if (!record.archiveDir) return;
    try {
      await ipc.revealInExplorer(record.archiveDir);
    } catch (error) {
      setNotice(String(error));
    }
  };

  const clearAll = async () => {
    setNotice(null);
    try {
      await ipc.clearBuildHistory();
      setIssuesOpen(null);
      setVersion((v) => v + 1);
    } catch (error) {
      setNotice(String(error));
    }
  };

  return (
    <DashSection label="Build history">
      {notice && <p className="text-sm text-ink-300">{notice}</p>}

      {records === null && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[132px] rounded-xl" />
          <Skeleton className="h-[132px] rounded-xl" />
        </div>
      )}

      {records !== null && records.length === 0 && (
        <EmptyState title="No builds recorded yet.">
          <p className="text-[12.5px] leading-[1.55] text-ink-500">
            Run a build or package above. Every run lands here with its duration, errors and
            warnings, and a Play button for packaged games.
          </p>
        </EmptyState>
      )}

      <div className="flex flex-col gap-3">
        {(records ?? []).map((record) => (
          <HistoryCard
            key={record.id}
            record={record}
            openSev={issuesOpen?.id === record.id ? issuesOpen.sev : null}
            onToggleIssues={(sev) =>
              setIssuesOpen((prev) =>
                prev?.id === record.id && prev.sev === sev ? null : { id: record.id, sev },
              )
            }
            onPlay={() => play(record)}
            onReveal={() => reveal(record)}
          />
        ))}
      </div>

      {records !== null && records.length > 0 && (
        <div>
          <ConfirmButton
            variant="ghost"
            onConfirm={clearAll}
            confirmLabel="Click again to clear everything"
          >
            Clear history
          </ConfirmButton>
        </div>
      )}
    </DashSection>
  );
}

function HistoryCard({
  record,
  openSev,
  onToggleIssues,
  onPlay,
  onReveal,
}: {
  record: BuildRecord;
  openSev: 1 | 2 | null;
  onToggleIssues: (sev: 1 | 2) => void;
  onPlay: () => void;
  onReveal: () => void;
}) {
  const cancelled = record.cancelled === true;
  const failed = record.exitCode !== 0 && !cancelled;
  const succeeded = record.exitCode === 0;
  const packaged = record.action === "package" && succeeded && !!record.archiveDir;
  const clean = record.errors === 0 && record.warnings === 0;

  return (
    <article className="flex flex-col gap-3.5 rounded-xl border border-border bg-ink-900 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="min-w-0 truncate text-[15px] font-semibold text-ink-100">
          {record.project}
        </span>
        <Tag>{ACTIONS.find((a) => a.key === record.action)?.label ?? record.action}</Tag>
        <Tag>
          {record.config} · {record.platform}
        </Tag>
        <span
          className={cn(
            "ml-auto flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
            succeeded && "border-ink-700 bg-ink-800/60 text-ink-100",
            failed && "border-signal-500/40 bg-signal-500/10 text-signal-400",
            cancelled && "border-ink-700 text-ink-400",
          )}
        >
          {succeeded ? (
            <CheckCircle2 className="size-3.5" aria-hidden />
          ) : cancelled ? (
            <Ban className="size-3.5" aria-hidden />
          ) : (
            <XCircle className="size-3.5" aria-hidden />
          )}
          {succeeded
            ? "Succeeded"
            : cancelled
              ? "Cancelled"
              : `Failed · code ${record.exitCode}`}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-x-9 gap-y-3">
        <CardStat label="Duration" value={formatDuration(record.durationMs)} />
        <CardStat
          label="Errors"
          value={fmtNumber(record.errors)}
          tone={record.errors > 0 ? undefined : "dim"}
        />
        <CardStat
          label="Warnings"
          value={fmtNumber(record.warnings)}
          tone={record.warnings > 0 ? undefined : "dim"}
        />
        <CardStat label="Started" value={formatWhen(record.startedAt)} small />
      </div>

      <StageBreakdown record={record} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {packaged && (
          <>
            <Button size="sm" onClick={onPlay}>
              <Play className="size-3" aria-hidden />
              Play
            </Button>
            <Button size="sm" variant="ghost" onClick={onReveal}>
              <FolderOpen className="size-3" aria-hidden />
              Open folder
            </Button>
          </>
        )}
        {clean ? (
          <span className="px-1 font-mono text-[11px] text-ink-500">
            Clean build · no warnings, no errors
          </span>
        ) : (
          <>
            <Button
              variant="chip"
              size="chip"
              aria-pressed={openSev === 2}
              disabled={record.errors === 0}
              onClick={() => onToggleIssues(2)}
            >
              Errors · {fmtNumber(record.errors)}
            </Button>
            <Button
              variant="chip"
              size="chip"
              aria-pressed={openSev === 1}
              disabled={record.warnings === 0}
              onClick={() => onToggleIssues(1)}
            >
              Warnings · {fmtNumber(record.warnings)}
            </Button>
          </>
        )}
      </div>

      {openSev !== null && <IssuesPanel record={record} sev={openSev} />}
    </article>
  );
}

function CardStat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: "signal" | "dim";
  small?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={cn(
          "font-semibold leading-none tabular-nums tracking-[-0.02em]",
          small ? "text-[13.5px] leading-[20px] text-ink-300" : "text-[22px]",
          tone === "signal" && "text-signal-400",
          tone === "dim" && "text-ink-500",
        )}
      >
        {value}
      </span>
      <Label size="micro">{label}</Label>
    </div>
  );
}

/** Where the time went: one segment per pipeline stage, packaged builds only. */
function StageBreakdown({ record }: { record: BuildRecord }) {
  const segments: { name: string; ms: number }[] = [];
  if (record.stages.length > 0 && record.stages[0].atMs > 1000) {
    segments.push({ name: "Prep", ms: record.stages[0].atMs });
  }
  record.stages.forEach((stage, index) => {
    const end = record.stages[index + 1]?.atMs ?? record.durationMs;
    if (end > stage.atMs) segments.push({ name: stage.name, ms: end - stage.atMs });
  });
  if (segments.length < 2) return null;
  const total = segments.reduce((sum, s) => sum + s.ms, 0);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full">
        {segments.map((segment) => (
          <div
            key={segment.name}
            className={cn("h-full", STAGE_SHADES[segment.name] ?? "bg-ink-700")}
            style={{ width: `${(segment.ms / total) * 100}%`, minWidth: 2 }}
            title={`${segment.name} · ${formatDuration(segment.ms)}`}
          />
        ))}
      </div>
      <div className="font-mono text-[10.5px] text-ink-500">
        {segments
          .map((segment) => `${segment.name} ${formatDuration(segment.ms)}`)
          .join(" · ")}
      </div>
    </div>
  );
}

type Issue = { text: string; count: number; firstT: number };

/** Collapse repeated identical lines into one issue with an occurrence count. */
function dedupeIssues(lines: BuildLogLine[], sev: 1 | 2): Issue[] {
  const map = new Map<string, Issue>();
  for (const line of lines) {
    if (line.sev !== sev) continue;
    const text = line.text.trim();
    if (!text) continue;
    const existing = map.get(text);
    if (existing) existing.count += 1;
    else map.set(text, { text, count: 1, firstT: line.t });
  }
  return [...map.values()];
}

const MAX_ISSUE_ROWS = 250;

function IssuesPanel({ record, sev }: { record: BuildRecord; sev: 1 | 2 }) {
  const { data: lines, error } = useAsync(() => ipc.buildLog(record.id, true), [record.id]);
  const issues = useMemo(() => (lines ? dedupeIssues(lines, sev) : null), [lines, sev]);
  const [copiedAll, fireCopiedAll] = useTimedFlag(1600);

  const kind = sev === 2 ? "errors" : "warnings";
  const total = issues?.reduce((sum, issue) => sum + issue.count, 0) ?? 0;
  const shown = issues?.slice(0, MAX_ISSUE_ROWS) ?? null;

  const copyAll = async () => {
    if (!issues || issues.length === 0) return;
    if (await copyText(issues.map((issue) => issue.text).join("\n"))) fireCopiedAll();
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      {error && <p className="text-sm text-ink-400">Couldn't read the log: {error}</p>}
      {!error && !issues && (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 rounded-md" />
          <Skeleton className="h-6 rounded-md" />
          <Skeleton className="h-6 rounded-md" />
        </div>
      )}
      {issues && issues.length === 0 && (
        <p className="text-sm text-ink-400">No {kind} in this build.</p>
      )}
      {issues && issues.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-500">
              {fmtNumber(issues.length)} unique{" "}
              {issues.length === 1 ? kind.slice(0, -1) : kind}
              {total > issues.length && ` · ${fmtNumber(total)} occurrences`}
            </span>
            <Button
              variant="link"
              size="none"
              className="text-[12px] font-normal"
              onClick={copyAll}
            >
              {copiedAll ? "Copied" : "Copy all"}
            </Button>
          </div>
          <div className="flex max-h-[320px] flex-col overflow-y-auto">
            {shown!.map((issue) => (
              <IssueRow key={issue.text} issue={issue} />
            ))}
            {issues.length > MAX_ISSUE_ROWS && (
              <p className="px-2 pt-2 font-mono text-[11px] text-ink-500">
                …and {fmtNumber(issues.length - MAX_ISSUE_ROWS)} more · use Copy
                all for the complete list.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="group flex min-w-0 items-center gap-2.5 rounded-md px-2 py-[3px] transition-[background-color] duration-[130ms] ease-brand hover:bg-ink-800">
      <span className="flex-none font-mono text-[10.5px] tabular-nums text-ink-400">
        {formatDuration(issue.firstT)}
      </span>
      <span
        className="min-w-0 flex-1 select-text truncate font-mono text-[11.5px] text-ink-300"
        title={issue.text}
      >
        {issue.text}
      </span>
      {issue.count > 1 && (
        <span
          className="flex-none rounded-full border border-border px-1.5 font-mono text-[10px] tabular-nums text-ink-500"
          title={`Repeated ${fmtNumber(issue.count)} times`}
        >
          ×{fmtNumber(issue.count)}
        </span>
      )}
      <CopyButton text={issue.text} />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, fireCopied] = useTimedFlag();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "size-6 flex-none rounded-md text-ink-500 opacity-0 transition-opacity duration-[130ms] group-hover:opacity-100 focus-visible:opacity-100",
        copied && "opacity-100",
      )}
      aria-label="Copy line"
      title="Copy line"
      onClick={async () => {
        if (await copyText(text)) fireCopied();
      }}
    >
      {copied ? (
        <Check className="size-3 text-ink-200" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
    </Button>
  );
}

function MachineSection() {
  const { data: stats, error } = usePolled(() => ipc.systemStats(), [], 8000, true, "system");

  return (
    <DashSection label="Machine">
      {error && !stats && <p className="text-ink-400">Couldn't read system stats.</p>}
      {!error && !stats && <p className="text-ink-400">Reading sensors…</p>}
      {stats && (
        <>
          <StatGrid>
            <Stat label={`CPU · ${stats.coreCount} threads`} value={`${Math.round(stats.cpuUsage)}%`} />
            <Stat
              label={`RAM of ${gb(stats.memTotal).toFixed(1)} GB`}
              value={`${gb(stats.memUsed).toFixed(1)} GB`}
            />
            <Stat
              label="CPU temp"
              value={stats.cpuTempC !== null ? `${Math.round(stats.cpuTempC)}°C` : MISSING}
            />
            {stats.gpu && (
              <>
                <Stat label="GPU" value={`${stats.gpu.usage}%`} />
                <Stat
                  label={`VRAM of ${gb(stats.gpu.memTotal).toFixed(1)} GB`}
                  value={`${gb(stats.gpu.memUsed).toFixed(1)} GB`}
                />
                <Stat
                  label="GPU temp"
                  value={stats.gpu.tempC !== null ? `${stats.gpu.tempC}°C` : MISSING}
                />
                <Stat
                  label="GPU power"
                  value={stats.gpu.powerW !== null ? `${Math.round(stats.gpu.powerW)} W` : MISSING}
                />
              </>
            )}
            {stats.disks.map((disk) => (
              <Stat
                key={disk.mount}
                label={`Free on ${disk.mount} · ${gb(disk.total).toFixed(1)} GB`}
                value={`${gb(disk.available).toFixed(1)} GB`}
              />
            ))}
          </StatGrid>
          <small className="text-xs text-ink-500">
            {stats.cpuName}
            {stats.gpu ? ` · ${stats.gpu.name}` : " · GPU stats need an NVIDIA card"}
            {stats.cpuTempC === null &&
              " · Windows keeps CPU temperature to itself on most boards"}
          </small>
        </>
      )}
    </DashSection>
  );
}

function Row({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-2 py-2.5 text-sm text-ink-200",
        !first && "border-t border-border",
      )}
    >
      {children}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
      <X className="size-2.5" aria-hidden />
    </Button>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <Label size="micro" className="w-[72px] flex-none">{label}</Label>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

