import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";

/**
 * Checks GitHub Releases for a newer version, and if the user accepts,
 * downloads + installs it and relaunches the app.
 *
 * Silent on failure: an offline machine or a draft release must never
 * surface an error dialog at startup.
 */
export async function checkForUpdates(): Promise<void> {
  if (import.meta.env.DEV) return;
  try {
    const update = await check();
    if (!update) return;

    const install = await ask(
      `UWebBrowser ${update.version} is available (you have ${update.currentVersion}).\n\nDownload and install it now?`,
      { title: "Update available", kind: "info", okLabel: "Update", cancelLabel: "Later" },
    );
    if (!install) return;

    await update.downloadAndInstall();

    const restart = await ask(
      "The update has been installed. Restart UWebBrowser to finish?",
      { title: "Update ready", kind: "info", okLabel: "Restart", cancelLabel: "Later" },
    );
    if (restart) await relaunch();
  } catch (err) {
    console.warn("Update check failed:", err);
  }
}
