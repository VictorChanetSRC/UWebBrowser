import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { elapsedSince } from "./format";
import { ipc, type BuildAction, type BuildRequest, type EngineInstall } from "./ipc";
import type { UnrealProject } from "./unreal";

/**
 * One build job at a time, held outside React so the log and progress
 * survive tab switches while UAT grinds away for minutes.
 */
export type BuildJob = {
  id: string;
  projectName: string;
  action: BuildAction;
  stage: string;
  startedAt: number;
  lines: string[];
  /** null while running; process exit code once finished. */
  exitCode: number | null;
  cancelRequested: boolean;
  /** Parsed from cook / UBT log lines; null until a stage reports counts. */
  progress: BuildProgress | null;
  /** Live warning/error line counts, same heuristic the history uses. */
  warnings: number;
  errors: number;
};

export type BuildProgress = {
  /** Stage the counts belong to; cleared when the pipeline moves on. */
  stage: string;
  done: number;
  total: number;
  /** Estimated seconds remaining; null until the rate settles. */
  etaSeconds: number | null;
};

const MAX_LINES = 600;

let current: BuildJob | null = null;
let snapshot: BuildJob | null = null;
const listeners = new Set<() => void>();
let wired = false;
let flushTimer: number | null = null;

/** Recent (time, done) points backing the ETA; sliding ~90s window. */
let rateSamples: { t: number; done: number }[] = [];

/** Mirrors the backend's severity heuristic for live counts. */
function classify(line: string): 0 | 1 | 2 {
  const l = line.toLowerCase();
  if (l.includes("error:") || l.includes(" error c") || l.includes("fatal error")) return 2;
  if (l.includes("warning:") || l.includes(" warning c")) return 1;
  return 0;
}

/* ------------------- ETA learning from recorded builds ------------------- */

/**
 * Medians from past successful builds of the same project/action/config/
 * platform. Refreshed when a job starts, so every finished build makes the
 * next estimate a little better.
 */
type HistoryStats = { totalMs: number | null; stageMs: Map<string, number> };
let historyStats: HistoryStats | null = null;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function loadHistoryStats(projectName: string, req: Omit<BuildRequest, "jobId">) {
  historyStats = null;
  try {
    const records = await ipc.buildHistory();
    const matches = records
      .filter(
        (r) =>
          r.project === projectName &&
          r.action === req.action &&
          r.config === req.config &&
          r.platform === req.platform &&
          r.exitCode === 0,
      )
      .slice(0, 8);
    if (matches.length === 0) return;
    const byStage = new Map<string, number[]>();
    for (const record of matches) {
      record.stages.forEach((stage, index) => {
        const end = record.stages[index + 1]?.atMs ?? record.durationMs;
        const spans = byStage.get(stage.name) ?? [];
        spans.push(Math.max(0, end - stage.atMs));
        byStage.set(stage.name, spans);
      });
    }
    const stageMs = new Map<string, number>();
    for (const [name, spans] of byStage) {
      const m = median(spans);
      if (m !== null) stageMs.set(name, m);
    }
    historyStats = { totalMs: median(matches.map((r) => r.durationMs)), stageMs };
  } catch {
    historyStats = null;
  }
}

const PACKAGE_STAGE_ORDER = ["Build", "Cook", "Stage", "Package", "Archive"];

/**
 * Best remaining-time estimate, in seconds: the live in-stage rate plus the
 * historical cost of the stages still to come, falling back to "median past
 * duration minus elapsed" before any counts arrive. Null = no idea yet.
 */
export function jobEta(job: BuildJob): number | null {
  if (job.exitCode !== null) return null;
  if (job.progress?.etaSeconds != null) {
    let restMs = 0;
    if (historyStats && job.action === "package") {
      const index = PACKAGE_STAGE_ORDER.indexOf(job.progress.stage);
      if (index >= 0) {
        for (const stage of PACKAGE_STAGE_ORDER.slice(index + 1)) {
          restMs += historyStats.stageMs.get(stage) ?? 0;
        }
      }
    }
    return job.progress.etaSeconds + restMs / 1000;
  }
  if (historyStats?.totalMs) {
    return Math.max(0, (historyStats.totalMs - (Date.now() - job.startedAt)) / 1000);
  }
  return null;
}

/** Bar fill 0..1: parsed stage counts first, elapsed vs. history otherwise. */
export function jobProgressValue(job: BuildJob): number | null {
  if (job.exitCode !== null) return null;
  if (job.progress) return job.progress.done / job.progress.total;
  if (historyStats?.totalMs) {
    return Math.min(0.98, (Date.now() - job.startedAt) / historyStats.totalMs);
  }
  return null;
}

/** True while the process is still running (no exit code yet). */
export function jobRunning(job: BuildJob): boolean {
  return job.exitCode === null;
}

/** The colour class for a job's settled status line: neutral on success,
 *  Signal on failure, and empty while still running or cancelling (so callers
 *  don't tint the live stage). One source so the dashboard tile, the work-bar
 *  card and the hub can't drift on what "failed" looks like. */
export function jobVerdictClass(job: BuildJob): string {
  if (jobRunning(job) || job.cancelRequested) return "";
  return job.exitCode === 0 ? "text-ink-100" : "text-signal-400";
}

/** Kick off a Win64 Development package for a linked project. No-ops if a build
 *  is already running. The one place the package request is spelled out, shared
 *  by the dashboard tile and the work-bar card. */
export function packageProject(project: UnrealProject, engine: EngineInstall): void {
  if (buildJobRunning()) return;
  startBuildJob(project.name, {
    enginePath: engine.path,
    uproject: project.uprojectPath,
    action: "package",
    config: "Development",
    platform: "Win64",
    archiveDir: project.archiveDir || undefined,
  });
}

/**
 * One-line status the three build views render: the live stage while running,
 * a settled verdict once done. Single source so Sidebar, Dashboard and the
 * Unreal hub can't drift.
 */
export function jobStatusLabel(job: BuildJob): string {
  if (jobRunning(job)) return job.cancelRequested ? "Cancelling…" : job.stage;
  if (job.cancelRequested) return "Cancelled";
  return job.exitCode === 0 ? "Finished" : `Failed (code ${job.exitCode})`;
}

/** Progress/ETA caption for a running job ("62% · ~4 min left"), or a
 *  "Starting…" placeholder before any signal. Empty once finished. */
export function jobProgressCaption(job: BuildJob): string {
  if (!jobRunning(job)) return "";
  const eta = jobEta(job);
  if (eta === null) return "Starting…";
  const value = jobProgressValue(job);
  const pct = value !== null ? `${Math.floor(value * 100)}% · ` : "";
  return `${pct}${formatEta(eta)} left`;
}

/** Resolve the notification permission, prompting once if still default.
 *  Shared by the "ask early" path in startBuildJob and the finish notification
 *  so the two can't drift on how the grant is requested. */
async function ensureNotifyPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

async function notifyFinished(job: BuildJob) {
  if (job.cancelRequested) return;
  try {
    if (!(await ensureNotifyPermission())) return;
    const ok = job.exitCode === 0;
    const issues =
      job.errors > 0 || job.warnings > 0
        ? ` · ${job.errors} errors, ${job.warnings} warnings`
        : "";
    sendNotification({
      title: ok ? "Build finished" : "Build failed",
      body: `${job.projectName} · ${job.action} · ${elapsedSince(job.startedAt)}${issues}`,
    });
  } catch {
    // Notifications are a courtesy; never let them break the job flow.
  }
}

// "LogCook: Display: Cooked packages 15808 Packages Remain 1332 Total 17140"
const COOK_RE = /Cooked packages\s+(\d+)\s+Packages Remain\s+\d+\s+Total\s+(\d+)/;
// UBT compile progress: "[123/456] Compile Foo.cpp"
const UBT_RE = /\[(\d+)\/(\d+)\]/;

function trackProgress(line: string) {
  if (!current || current.exitCode !== null) return;
  let done: number;
  let total: number;
  const cook = COOK_RE.exec(line);
  if (cook) {
    done = Number(cook[1]);
    total = Number(cook[2]);
  } else {
    const ubt = UBT_RE.exec(line);
    if (!ubt) return;
    done = Number(ubt[1]);
    total = Number(ubt[2]);
  }
  if (total < 2 || done > total) return;

  // A different total means a new phase (another UBT pass, a fresh cook
  // list) — old points would poison the rate.
  if (
    !current.progress ||
    current.progress.total !== total ||
    current.progress.stage !== current.stage ||
    done < current.progress.done
  ) {
    rateSamples = [];
  }

  const now = Date.now();
  rateSamples.push({ t: now, done });
  while (rateSamples.length > 2 && now - rateSamples[0].t > 90_000) {
    rateSamples.shift();
  }

  const first = rateSamples[0];
  const spanSeconds = (now - first.t) / 1000;
  const gained = done - first.done;
  const etaSeconds =
    spanSeconds >= 5 && gained > 0
      ? ((total - done) / gained) * spanSeconds
      : (current.progress?.etaSeconds ?? null);

  current.progress = { stage: current.stage, done, total, etaSeconds };
}

function publish() {
  snapshot = current ? { ...current } : null;
  listeners.forEach((listener) => listener());
}

/** UAT floods stdout; batch line updates so React isn't re-rendered per line. */
function schedulePublish() {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    publish();
  }, 120);
}

/** Fold one output line into the running job: append, count its severity,
 *  and feed progress tracking. Caller trims and publishes. */
function ingestLine(line: string) {
  if (!current) return;
  current.lines.push(line);
  const sev = classify(line);
  if (sev === 2) current.errors += 1;
  else if (sev === 1) current.warnings += 1;
  trackProgress(line);
}

function wire() {
  if (wired) return;
  wired = true;
  ipc.onBuildEvent(({ id, kind, value, lines }) => {
    if (!current || current.id !== id) return;
    // The backend batches output as `lines`; `line` is kept for compatibility.
    if (kind === "line" || kind === "lines") {
      const batch = kind === "lines" ? lines ?? [] : [value];
      for (const line of batch) ingestLine(line);
      if (current.lines.length > MAX_LINES) {
        current.lines.splice(0, current.lines.length - MAX_LINES);
      }
      schedulePublish();
      return;
    }
    if (kind === "stage") {
      current.stage = value;
      // Counts from a finished stage say nothing about the next one.
      if (current.progress && current.progress.stage !== value) {
        current.progress = null;
        rateSamples = [];
      }
    }
    if (kind === "done") {
      current.exitCode = Number(value);
      notifyFinished(current);
    }
    publish();
  });
}

export function subscribeBuildJob(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBuildJob(): BuildJob | null {
  return snapshot;
}

export function buildJobRunning(): boolean {
  return current !== null && current.exitCode === null;
}

export async function startBuildJob(
  projectName: string,
  req: Omit<BuildRequest, "jobId">,
): Promise<void> {
  if (buildJobRunning()) return;
  wire();
  const id = crypto.randomUUID();
  current = {
    id,
    projectName,
    action: req.action,
    stage: "Starting",
    startedAt: Date.now(),
    lines: [],
    exitCode: null,
    cancelRequested: false,
    progress: null,
    warnings: 0,
    errors: 0,
  };
  rateSamples = [];
  loadHistoryStats(projectName, req);
  // Ask early so the finish notification doesn't hit a pending permission.
  ensureNotifyPermission().catch(() => {});
  publish();
  try {
    await ipc.startBuild({ ...req, jobId: id });
  } catch (error) {
    current.lines.push(`Failed to start: ${error}`);
    current.exitCode = -1;
    publish();
  }
}

export async function cancelBuildJob(): Promise<void> {
  if (!current || current.exitCode !== null) return;
  current.cancelRequested = true;
  publish();
  try {
    await ipc.cancelBuild(current.id);
  } catch {
    // The job may have just finished; the done event settles it either way.
  }
}

export function clearBuildJob() {
  if (buildJobRunning()) return;
  current = null;
  publish();
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h} h ${m} min` : `~${h} h`;
}

