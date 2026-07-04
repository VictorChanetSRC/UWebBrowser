use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, Window,
};

pub const CHROME_LABEL: &str = "chrome";
pub const TAB_PREFIX: &str = "tab-";

#[derive(Default)]
pub struct TabsState {
    pub insets: Mutex<Insets>,
}

#[derive(Clone, Copy, Default)]
pub struct Insets {
    pub top: f64,
    pub left: f64,
    /// Space reserved on the right for chrome overlays (the password panel);
    /// keeps the page visible beside them instead of hiding the webview.
    pub right: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabEvent {
    id: String,
    kind: String,
    value: String,
}

fn emit_tab_event(app: &AppHandle, id: &str, kind: &str, value: String) {
    let _ = app.emit_to(
        CHROME_LABEL,
        "tab-event",
        TabEvent {
            id: id.to_string(),
            kind: kind.to_string(),
            value,
        },
    );
}

pub fn tab_label(id: &str) -> String {
    format!("{TAB_PREFIX}{id}")
}

/// The tab id inside a webview label, i.e. the inverse of `tab_label`. Returns
/// None for non-tab labels (e.g. the chrome webview).
pub fn tab_id_of(label: &str) -> Option<&str> {
    label.strip_prefix(TAB_PREFIX)
}

/// Only real navigable schemes plus our internal `uwb:` are allowed; anything
/// else (javascript:, data:, …) is rejected here rather than trusting the
/// frontend to have normalized it. file: is deliberately in — local documents
/// opened via the OS file association or a typed path render like in any
/// browser.
fn check_scheme(url: &Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" | "file" | "uwb" => Ok(()),
        other => Err(format!("unsupported url scheme: {other}")),
    }
}

/// Tab webviews live in their own browsing profile, separate from the chrome
/// webview's default profile. Clearing site data must never touch the chrome
/// UI's storage (config, pins, settings live in its localStorage).
fn browsing_data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join("browsing"))
}

fn content_rect(
    window: &Window,
    insets: Insets,
) -> tauri::Result<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let scale = window.scale_factor()?;
    let size = window.inner_size()?.to_logical::<f64>(scale);
    Ok((
        LogicalPosition::new(insets.left, insets.top),
        LogicalSize::new(
            (size.width - insets.left - insets.right).max(1.0),
            (size.height - insets.top).max(1.0),
        ),
    ))
}

pub fn apply_bounds_to_all(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let insets = *app.state::<TabsState>().insets.lock().unwrap();
    let Ok((pos, size)) = content_rect(&window, insets) else {
        return;
    };
    for (label, webview) in app.webviews() {
        if label.starts_with(TAB_PREFIX) {
            let _ = webview.set_position(pos);
            let _ = webview.set_size(size);
        }
    }
}

#[tauri::command]
pub async fn create_tab(
    app: AppHandle,
    state: tauri::State<'_, TabsState>,
    id: String,
    url: String,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or("main window not found")?;
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    check_scheme(&parsed)?;
    let insets = *state.insets.lock().unwrap();
    let (pos, size) = content_rect(&window, insets).map_err(|e| e.to_string())?;

    let app_title = app.clone();
    let id_title = id.clone();
    let app_nav = app.clone();
    let id_nav = id.clone();
    let app_load = app.clone();
    let id_load = id.clone();
    let app_new = app.clone();
    let id_new = id.clone();

    let mut builder = tauri::webview::WebviewBuilder::new(tab_label(&id), WebviewUrl::External(parsed))
        // Hand drag-and-drop back to WebView2 so pages behave like they do in
        // a normal browser (in-page HTML5 DnD and file drops both work);
        // Tauri's own handler blocks HTML5 drag events on Windows.
        .disable_drag_drop_handler()
        // Password-manager helpers + best-effort autofill, injected at document
        // start on every frame. See src/passwords/content.js.
        .initialization_script(crate::passwords::content_script())
        .on_document_title_changed(move |_webview, title| {
            emit_tab_event(&app_title, &id_title, "title", title);
        })
        .on_navigation(move |url| {
            emit_tab_event(&app_nav, &id_nav, "url", url.to_string());
            true
        })
        // window.open() / target="_blank" raise NewWindowRequested instead of
        // navigating; without a handler the engine silently drops the request.
        // Route the URL to the chrome UI, which opens it as a regular tab.
        // Deny keeps the engine from spawning its own popup window; it also
        // means window.open() returns null to the page, so opener-based popup
        // flows (some OAuth logins) don't work — no worse than before.
        .on_new_window(move |url, _features| {
            if check_scheme(&url).is_ok() {
                emit_tab_event(&app_new, &id_new, "new-tab", url.to_string());
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_webview, payload| {
            let started = matches!(payload.event(), PageLoadEvent::Started);
            emit_tab_event(&app_load, &id_load, "loading", started.to_string());
            if !started {
                emit_tab_event(&app_load, &id_load, "url", payload.url().to_string());
                // Push matching logins into the page for inline autofill.
                crate::passwords::prime_tab(&app_load, &id_load, payload.url().as_str());
            }
        });

    if let Some(dir) = browsing_data_dir(&app) {
        builder = builder.data_directory(dir);
    }

    // Hide the currently visible tab; the new webview stacks on top.
    for (label, webview) in app.webviews() {
        if label.starts_with(TAB_PREFIX) {
            let _ = webview.hide();
        }
    }

    window.add_child(builder, pos, size).map_err(|e| e.to_string())?;
    // The chrome UI reports its insets asynchronously; if they arrived while
    // this webview was being built, the rect computed above is stale and the
    // page would cover the chrome. Re-position from the current insets.
    apply_bounds_to_all(&app);
    Ok(())
}

#[tauri::command]
pub async fn navigate_tab(app: AppHandle, id: String, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    check_scheme(&parsed)?;
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_tab(app: AppHandle, id: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    webview.close().map_err(|e| e.to_string())
}

/// Show the webview for `id`, hide every other tab webview.
/// Pass no id to hide all tabs (internal pages like the dashboard).
#[tauri::command]
pub async fn activate_tab(app: AppHandle, id: Option<String>) -> Result<(), String> {
    let active = id.map(|i| tab_label(&i));
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        if Some(&label) == active.as_ref() {
            // TODO(perf M4): on Windows, Resume() the WebView2 controller here
            // (via webview.with_webview(|w| w.controller())) before showing, to
            // wake a tab that was TrySuspend()'d below. See the note on hide().
            webview.show().map_err(|e| e.to_string())?;
        } else {
            let _ = webview.hide();
            // TODO(perf M4): best-effort TrySuspend() of the native WebView2 to
            // reclaim memory on a backgrounded tab. Skipped for now: reaching
            // ICoreWebView2_3::TrySuspend needs webview2-com + the `windows`
            // crate as direct deps at versions matching Tauri's, which is a
            // nontrivial dependency add and risks build breakage. Left out per
            // "do not break the build chasing this."
        }
    }
    Ok(())
}

/// Run a script inside a tab webview. Used for history navigation and reload.
#[tauri::command]
pub async fn tab_eval(app: AppHandle, id: String, js: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    webview.eval(&js).map_err(|e| e.to_string())
}

/// Clear cache, cookies and site data for the browsing profile. While tab
/// webviews are alive the engine clears the profile in place; with no tabs
/// open the profile directory is simply deleted from disk.
#[tauri::command]
pub async fn clear_browsing_data(app: AppHandle) -> Result<(), String> {
    let tab = app
        .webviews()
        .into_iter()
        .find(|(label, _)| label.starts_with(TAB_PREFIX));
    if let Some((_, webview)) = tab {
        return webview.clear_all_browsing_data().map_err(|e| e.to_string());
    }
    if let Some(dir) = browsing_data_dir(&app) {
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| {
                format!("could not remove browsing data ({e}); the web engine may still be shutting down — try again in a few seconds")
            })?;
        }
    }
    Ok(())
}

/// The chrome UI reports the size of its top bar and sidebar so tab webviews
/// can be laid out over the remaining content area.
#[tauri::command]
pub async fn set_content_insets(
    app: AppHandle,
    state: tauri::State<'_, TabsState>,
    top: f64,
    left: f64,
    right: f64,
) -> Result<(), String> {
    *state.insets.lock().unwrap() = Insets { top, left, right };
    apply_bounds_to_all(&app);
    Ok(())
}
