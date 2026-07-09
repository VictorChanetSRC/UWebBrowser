import { getVersion } from "@tauri-apps/api/app";
import { loadStr, saveStr } from "./storage";

/**
 * GitHub interconnect: where the repo lives, prefilled-issue URL building
 * for the feedback dialog, and the star-nudge bookkeeping (sessions,
 * snoozes, "already starred"). Live stats come from the backend via
 * ipc.githubRepoStats / ipc.githubReleases, which cache for 15 minutes.
 */

/** Mirrored in src-tauri/src/github.rs. */
export const GITHUB_REPO = "VictorChanetSRC/UWebBrowser";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new/choose`;

export type FeedbackKind = "bug" | "idea";

/**
 * Environment lines pasted into a bug report so the reporter never has to
 * hunt them down. Kept to what a triage actually needs: app, OS, WebView2.
 */
export async function gatherDiagnostics(): Promise<string> {
  const version = await getVersion().catch(() => "unknown");
  const ua = navigator.userAgent;
  const os = /Windows NT [\d.]+(?:; [^;)]+)*/.exec(ua)?.[0] ?? navigator.platform;
  const webview = /Edg\/[\d.]+/.exec(ua)?.[0]?.replace("Edg/", "") ?? "unknown";
  return [
    `App: UWebBrowser v${version}`,
    `OS: ${os}`,
    `WebView2: ${webview}`,
    `Locale: ${navigator.language}`,
  ].join("\n");
}

/**
 * A `/issues/new` URL that lands on the matching issue form with the user's
 * text (and diagnostics, for bugs) already filled in. Query keys other than
 * `template`/`title` map onto the form's field ids — see
 * .github/ISSUE_TEMPLATE/*.yml.
 */
export function feedbackIssueUrl(
  kind: FeedbackKind,
  title: string,
  details: string,
  diagnostics?: string,
): string {
  const params = new URLSearchParams();
  params.set("template", kind === "bug" ? "bug_report.yml" : "idea.yml");
  if (title.trim()) params.set("title", title.trim());
  if (details.trim()) params.set(kind === "bug" ? "what" : "idea", details.trim());
  if (kind === "bug" && diagnostics) params.set("diagnostics", diagnostics);
  return `${GITHUB_REPO_URL}/issues/new?${params.toString()}`;
}

/* -------------------------------- star nudge ------------------------------- */

const SESSIONS_KEY = "uwb.github.sessions";
const LAST_VERSION_KEY = "uwb.github.lastVersion";
/** "done" once the user clicked through; otherwise a snooze-until timestamp. */
const NUDGE_KEY = "uwb.github.starNudge";

/** Enough sessions to know they're a regular, not a first impression. */
const NUDGE_AFTER_SESSIONS = 5;
const NUDGE_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/** Guards the once-per-boot session count against dev double-mounts. */
let sessionRecorded = false;

/**
 * Call once at boot: bumps the session counter, tracks the version we last
 * ran as, and reports whether this is the moment to ask for a star — the
 * user is a returning regular, or they just came back after an update, and
 * they haven't clicked through or snoozed us recently.
 */
export async function startGithubSession(): Promise<boolean> {
  let sessions = Number(loadStr(SESSIONS_KEY)) || 0;
  let updated = false;

  if (!sessionRecorded) {
    sessionRecorded = true;
    sessions += 1;
    saveStr(SESSIONS_KEY, String(sessions));

    const version = await getVersion().catch(() => "");
    if (version) {
      const last = loadStr(LAST_VERSION_KEY);
      updated = last !== null && last !== version;
      saveStr(LAST_VERSION_KEY, version);
    }
  }

  const state = loadStr(NUDGE_KEY);
  if (state === "done") return false;
  if (state && Date.now() < Number(state)) return false;
  // Post-update still waits out the first session or two, so the very first
  // auto-update a new user sees isn't immediately followed by an ask.
  return sessions >= NUDGE_AFTER_SESSIONS || (updated && sessions >= 3);
}

/** They clicked through to the repo — never ask again. */
export function markStarNudgeDone() {
  saveStr(NUDGE_KEY, "done");
}

/** "Not now": quiet for two weeks, then eligible again. */
export function snoozeStarNudge() {
  saveStr(NUDGE_KEY, String(Date.now() + NUDGE_SNOOZE_MS));
}
