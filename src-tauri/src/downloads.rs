//! Commands backing the downloads panel. The *progress* wiring (start/progress/
//! done/fail/cancel events) lives natively in `webext.rs`, where the WebView2
//! `DownloadStarting` event is handled; this module only carries the user
//! actions the panel offers: cancel an in-flight download, open a finished file
//! with its default app, and reveal it in the file manager.

use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

/// Cancel an in-progress download by the id we assigned it. Delegates to
/// `webext`, which marshals the cancel onto the UI thread that owns the
/// WebView2 download operation.
#[tauri::command]
pub async fn download_cancel(app: AppHandle, id: String) -> Result<(), String> {
    crate::webext::cancel_download(&app, id);
    Ok(())
}

/// Open a completed download with the OS default application for its type.
#[tauri::command]
pub async fn download_open(path: String) -> Result<(), String> {
    // exists() stats the disk and spawn blocks briefly; keep both off the async
    // worker, mirroring reveal_in_explorer.
    tauri::async_runtime::spawn_blocking(move || {
        if !PathBuf::from(&path).exists() {
            return Err(format!("{path} isn’t there anymore — it may have been moved or deleted."));
        }
        open_file(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reveal a downloaded file in the system file manager, selected.
#[tauri::command]
pub async fn download_show(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !PathBuf::from(&path).exists() {
            return Err(format!("{path} isn’t there anymore — it may have been moved or deleted."));
        }
        show_file(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Launch a file with its default handler. On Windows `explorer <file>` opens
/// the file's default program (no shell, so paths with spaces pass as one arg).
fn open_file(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    // explorer.exe returns a non-zero exit code even on success, so we don't
    // wait on it — spawning is enough.
    cmd.arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Open the file manager with the file selected (Windows `/select,`), so the
/// user lands on the exact download rather than just its folder.
fn show_file(path: &str) -> Result<(), String> {
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
