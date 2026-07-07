use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, Window,
};

pub const CHROME_LABEL: &str = "chrome";
pub const TAB_PREFIX: &str = "tab-";

/// User-Agent for page webviews. WebView2's default UA carries an `Edg/…` token,
/// so sites that branch on the browser (e.g. Proton, which then targets its
/// *Edge* extension id for the login handoff) misidentify us — but we install
/// extensions from the *Chrome* Web Store. Presenting as vanilla Chrome keeps
/// the browser identity and the installed extension ids consistent. Bump the
/// version occasionally alongside `extensions::CHROME_VERSION`.
const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Default)]
pub struct TabsState {
    pub insets: Mutex<Insets>,
}

#[derive(Clone, Copy, Default)]
pub struct Insets {
    pub top: f64,
    pub left: f64,
    /// Space reserved on the right for chrome overlays; keeps the page visible
    /// beside them instead of hiding the webview.
    pub right: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabEvent {
    id: String,
    kind: String,
    value: String,
}

pub(crate) fn emit_tab_event(app: &AppHandle, id: &str, kind: &str, value: String) {
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

/// Ask the chrome UI to open `url` as a foreground tab. Raised by any webview
/// that makes a new-window request: regular tab pages (via `on_new_window`) and
/// the extension popup, whose "sign in" buttons open an auth page with
/// `window.open`/`chrome.tabs.create`. `source_id` is the originating webview's
/// tab id (or the popup label) — the chrome UI ignores it for `new-tab` events,
/// but passing it keeps the event shape uniform.
pub(crate) fn open_in_new_tab(app: &AppHandle, source_id: &str, url: &Url) {
    // A web page's window.open()/target=_blank must not be able to auto-open a
    // local file; restrict new-window requests to remote schemes and our
    // internal uwb: pages. Typed paths and OS file associations still reach
    // file: through create_tab / navigate_tab, which the user drives directly.
    if matches!(url.scheme(), "http" | "https" | "uwb") {
        emit_tab_event(app, source_id, "new-tab", url.to_string());
    }
}

pub fn tab_label(id: &str) -> String {
    format!("{TAB_PREFIX}{id}")
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
pub(crate) fn browsing_data_dir(app: &AppHandle) -> Option<PathBuf> {
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
    let insets = *app.state::<TabsState>().insets.lock().unwrap_or_else(|e| e.into_inner());
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
    let insets = *state.insets.lock().unwrap_or_else(|e| e.into_inner());
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
        // Present as vanilla Chrome (not Edge) so extension-aware sites target
        // the Chrome Web Store ids we install. See CHROME_UA.
        .user_agent(CHROME_UA)
        // Hand drag-and-drop back to WebView2 so pages behave like they do in
        // a normal browser (in-page HTML5 DnD and file drops both work);
        // Tauri's own handler blocks HTML5 drag events on Windows.
        .disable_drag_drop_handler()
        .on_document_title_changed(move |_webview, title| {
            emit_tab_event(&app_title, &id_title, "title", title);
        })
        .on_navigation(move |url| {
            // Only real navigable schemes may drive the top frame — the same
            // policy as `check_scheme`. This stops a page from stranding the
            // tab on a blank white page: the "open a blank window, then set its
            // location" popup pattern (which we can't fully honour, since a
            // denied window.open() returns null) otherwise leaves the frame at
            // about:blank, and data:/javascript: top-frame loads are a phishing
            // vector Chrome blocks too. Main-frame only — iframes (ads,
            // sandboxes) fire a different WebView2 event and are unaffected, so
            // the countless legitimate about:blank iframes still load.
            let ok = matches!(url.scheme(), "http" | "https" | "file" | "uwb");
            if ok {
                emit_tab_event(&app_nav, &id_nav, "url", url.to_string());
            }
            ok
        })
        // window.open() / target="_blank" raise NewWindowRequested instead of
        // navigating; without a handler the engine silently drops the request.
        // Route the URL to the chrome UI, which opens it as a regular tab.
        // Deny keeps the engine from spawning its own popup window; it also
        // means window.open() returns null to the page, so opener-based popup
        // flows (some OAuth logins) don't work — no worse than before.
        .on_new_window(move |url, _features| {
            open_in_new_tab(&app_new, &id_new, &url);
            NewWindowResponse::Deny
        })
        .on_page_load(move |_webview, payload| {
            let started = matches!(payload.event(), PageLoadEvent::Started);
            // Never surface a non-navigable URL (about:blank etc.) as the tab's
            // address. `on_navigation` already cancels these, but WebView2's
            // NavigationStarting is documented to sometimes skip about:blank —
            // this is the backstop so a blank load can't paint the omnibox.
            let navigable = matches!(payload.url().scheme(), "http" | "https" | "file" | "uwb");
            if !navigable {
                return;
            }
            emit_tab_event(&app_load, &id_load, "loading", started.to_string());
            if !started {
                emit_tab_event(&app_load, &id_load, "url", payload.url().to_string());
            }
        });

    if let Some(dir) = browsing_data_dir(&app) {
        builder = builder.data_directory(dir);
    }

    // Let installed Chrome extensions run in the page: content scripts inject
    // and background logic sees this tab. Windows/WebView2 only; a no-op
    // elsewhere. Shares the `browsing` profile with the extension host so the
    // set of extensions is one and the same.
    builder = builder.browser_extensions_enabled(true);
    if let Some(dir) = crate::extensions::extensions_dir(&app) {
        builder = builder.extensions_path(dir);
    }

    // Hide the currently visible tab; the new webview stacks on top.
    for (label, webview) in app.webviews() {
        if label.starts_with(TAB_PREFIX) {
            let _ = webview.hide();
        }
    }

    let webview = window.add_child(builder, pos, size).map_err(|e| e.to_string())?;
    // Native WebView2 wiring Tauri doesn't surface: forward browser keyboard
    // accelerators to the chrome UI (they'd otherwise die when the page has
    // focus), detect renderer crashes, enable page zoom, and read the real
    // favicon. No-op off Windows.
    crate::webext::install_tab_hooks(&app, &webview, &id);
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
            // Wake a tab that was suspended while backgrounded, then show it.
            crate::webext::resume(&webview);
            webview.show().map_err(|e| e.to_string())?;
        } else {
            let _ = webview.hide();
            // Free the backgrounded renderer's working set (state is preserved
            // and restored by resume above). This is what keeps many open tabs
            // from each pinning a full live renderer, à la Chrome's tab freezing.
            crate::webext::suspend(&webview);
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

/// Find-in-page. Drives Chromium's built-in `window.find`, which moves the
/// selection and scrolls the first match into view — a lightweight Ctrl+F with
/// no extra COM. `forward`/`from_start` let the chrome find bar step matches and
/// restart the search when the query changes.
#[tauri::command]
pub async fn tab_find(
    app: AppHandle,
    id: String,
    query: String,
    forward: bool,
    from_start: bool,
) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    // JSON-encode the query so quotes/backslashes can't break out of the script.
    let q = serde_json::to_string(&query).map_err(|e| e.to_string())?;
    let js = if query.is_empty() {
        // Clear the highlight when the bar empties.
        "window.getSelection()?.removeAllRanges();".to_string()
    } else {
        format!(
            "(function(){{try{{\
               if({from_start})window.getSelection()?.collapseToStart();\
               window.find({q},false,{back},true,false,false,false);\
             }}catch(e){{}}}})()",
            back = if forward { "false" } else { "true" },
        )
    };
    webview.eval(&js).map_err(|e| e.to_string())
}

/// Open the native Chromium DevTools window for a tab (Elements, Console,
/// Network, Sources — the real inspector). Driven by the toolbar button, F12
/// and Ctrl+Shift+I.
#[tauri::command]
pub async fn tab_devtools(app: AppHandle, id: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    crate::webext::open_devtools(&webview);
    Ok(())
}

/// Set a tab's zoom factor (1.0 == 100%). Used by the toolbar zoom controls;
/// Ctrl+/Ctrl- while a page is focused are handled natively in `webext`.
#[tauri::command]
pub async fn tab_zoom(app: AppHandle, id: String, factor: f64) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    crate::webext::set_zoom(&webview, factor.clamp(0.25, 5.0));
    Ok(())
}

/// The tab's *current* document URL, read live from the engine. Single-page
/// apps (the Chrome Web Store, etc.) navigate via the History API, which raises
/// no page-load event, so the frontend polls this to keep the omnibox — and the
/// Web Store "Add" button — in step with client-side route changes.
#[tauri::command]
pub async fn tab_live_url(app: AppHandle, id: String) -> Result<String, String> {
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    webview.url().map(|u| u.to_string()).map_err(|e| e.to_string())
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
            // The profile can be large; deleting it off the async worker keeps
            // it from stalling other commands.
            tauri::async_runtime::spawn_blocking(move || std::fs::remove_dir_all(&dir))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| {
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
    *state.insets.lock().unwrap_or_else(|e| e.into_inner()) = Insets { top, left, right };
    apply_bounds_to_all(&app);
    Ok(())
}
