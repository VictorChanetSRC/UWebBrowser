import { getVersion } from "@tauri-apps/api/app";

/**
 * GitHub interconnect: where the repo lives, and prefilled-issue URL building
 * for the feedback dialog. Live stats come from the backend via
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

