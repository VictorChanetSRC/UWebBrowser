//! Commands backing the downloads panel. The *progress* wiring (start/progress/
//! done/fail/cancel events) lives natively in `webext.rs`, where the WebView2
//! `DownloadStarting` event is handled; this module only carries the user
//! actions the panel offers: cancel an in-flight download, open a finished file
//! with its default app, and reveal it in the file manager.

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
    crate::os::with_existing_path(path, crate::os::open_path).await
}

/// Reveal a downloaded file in the system file manager, selected.
#[tauri::command]
pub async fn download_show(path: String) -> Result<(), String> {
    crate::os::with_existing_path(path, crate::os::reveal_path).await
}
