import type { EngineInstall, UProjectInfo } from "./ipc";
import { uid } from "./list-ops";
import { loadJson, saveJson } from "./storage";

export type UnrealProject = {
  id: string;
  name: string;
  uprojectPath: string;
  dir: string;
  /** From the .uproject: "5.4" for launcher engines, a GUID for source builds. */
  engineAssociation: string;
  hasCode: boolean;
  /** Engine the user picked for this project; empty = auto-match. */
  engineId: string;
  /** Game from the dashboard setup this project builds; empty = unlinked. */
  gameId: string;
  /** Custom package destination; empty = <project>\Packaged\<platform>. */
  archiveDir?: string;
};

export type UnrealState = {
  /** Engines linked by hand; detected ones are re-scanned on each visit. */
  manualEngines: EngineInstall[];
  projects: UnrealProject[];
};

const KEY = "uwb.unreal";

export const emptyUnrealState: UnrealState = {
  manualEngines: [],
  projects: [],
};

function validate(raw: unknown): UnrealState | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as { manualEngines?: unknown; projects?: unknown };
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  return {
    manualEngines: Array.isArray(parsed.manualEngines) ? parsed.manualEngines : [],
    // Older saves predate the game link; default it in.
    projects: projects.map((p: UnrealProject) => ({ ...p, gameId: p.gameId ?? "" })),
  };
}

export function loadUnrealState(): UnrealState {
  return loadJson([KEY], validate, () => ({ ...emptyUnrealState }));
}

/* ------------------------------ shared store ------------------------------ */
// One copy of the persisted Unreal state, shared by the dashboard's build
// section and the Unreal hub via useSyncExternalStore. Previously each held its
// own useState snapshot, so edits on one screen silently diverged from the
// other until a remount.

let state: UnrealState = loadUnrealState();
const listeners = new Set<() => void>();

export function getUnrealState(): UnrealState {
  return state;
}

export function subscribeUnrealState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateUnrealState(
  next: UnrealState | ((prev: UnrealState) => UnrealState),
): void {
  state = typeof next === "function" ? next(state) : next;
  saveJson(KEY, state);
  listeners.forEach((listener) => listener());
}

/** Detected engines plus any manually linked ones not already detected (keyed
 *  by path, case-insensitively). */
export function mergeEngines(
  detected: EngineInstall[],
  manual: EngineInstall[],
): EngineInstall[] {
  const seen = new Set(detected.map((e) => e.path.toLowerCase()));
  return [...detected, ...manual.filter((e) => !seen.has(e.path.toLowerCase()))];
}

/** Build an {@link UnrealProject} from a picked .uproject and its parsed info. */
export function makeProject(
  info: UProjectInfo,
  uprojectPath: string,
  gameId = "",
): UnrealProject {
  return {
    id: uid(),
    name: info.name,
    uprojectPath,
    dir: info.dir,
    engineAssociation: info.engineAssociation,
    hasCode: info.hasCode,
    engineId: "",
    gameId,
  };
}

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The Unreal project behind a dashboard game: an explicit link wins,
 * otherwise an unlinked project with the same (normalized) name.
 */
export function projectForGame(
  projects: UnrealProject[],
  game: { id: string; name: string },
): UnrealProject | null {
  const linked = projects.find((p) => p.gameId === game.id);
  if (linked) return linked;
  const target = normalizeName(game.name);
  if (!target) return null;
  return projects.find((p) => !p.gameId && normalizeName(p.name) === target) ?? null;
}

/**
 * Pick the engine a project should build with: an explicit choice first,
 * then the .uproject association (GUID for source builds, "5.4"-style
 * version prefix for launcher installs), then whatever is available.
 */
export function matchEngine(
  project: UnrealProject,
  engines: EngineInstall[],
): EngineInstall | null {
  if (project.engineId) {
    const chosen = engines.find((e) => e.id === project.engineId);
    if (chosen) return chosen;
  }
  const assoc = project.engineAssociation;
  if (assoc) {
    const byId = engines.find((e) => e.id === assoc || `{${e.id}}` === assoc);
    if (byId) return byId;
    const version = assoc.replace(/^UE_/, "");
    const byVersion = engines.find((e) => e.version.startsWith(version));
    if (byVersion) return byVersion;
  }
  return engines[0] ?? null;
}
