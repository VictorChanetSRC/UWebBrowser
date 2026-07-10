//! Handing a *file-system path* to the desktop: open it with its default
//! application, or reveal it in the file manager.
//!
//! Distinct from `tabs::os_open`, which hands a *URL* (`mailto:`, `steam://`, …)
//! to the shell via `ShellExecuteW` after a scheme check. Paths are passed to a
//! spawned process as a single argv entry, so spaces and quotes need no
//! escaping and no shell is involved.

use std::path::PathBuf;
use std::process::Command;

/// Run `job` against `path` on a blocking thread, but only if the path still
/// exists. `exists()` stats the disk and `spawn` blocks briefly, so neither
/// belongs on an async worker — and a download the user has since moved should
/// say so rather than failing silently.
pub async fn with_existing_path<F>(path: String, job: F) -> Result<(), String>
where
    F: FnOnce(&str) -> Result<(), String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        if !PathBuf::from(&path).exists() {
            return Err(format!(
                "{path} isn’t there anymore — it may have been moved or deleted."
            ));
        }
        job(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The platform's "open this with whatever handles it" command.
fn opener() -> Command {
    #[cfg(windows)]
    // `explorer <file>` opens the file's default program. No shell, so the path
    // passes as one argument.
    return Command::new("explorer");
    #[cfg(target_os = "macos")]
    return Command::new("open");
    #[cfg(all(not(windows), not(target_os = "macos")))]
    return Command::new("xdg-open");
}

/// Launch a file (or open a folder) with its default handler.
pub fn open_path(path: &str) -> Result<(), String> {
    // explorer.exe returns a non-zero exit code even on success, so we don't
    // wait on it — spawning is enough.
    opener().arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Open the file manager with the file selected, so the user lands on the exact
/// file rather than just its folder.
pub fn reveal_path(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", path])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        // No portable "select"; open the containing folder.
        let dir = PathBuf::from(path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from(path));
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
