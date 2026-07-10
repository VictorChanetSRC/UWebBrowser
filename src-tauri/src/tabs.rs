use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, Window,
};

pub const CHROME_LABEL: &str = "chrome";
pub const TAB_PREFIX: &str = "tab-";
/// The single, reused docked-DevTools panel webview. Not tab-prefixed, so the
/// tab layout/visibility loops skip it — its geometry and show/hide are driven
/// separately by `apply_bounds_to_all`.
pub const DEVTOOLS_LABEL: &str = "devtools-panel";

/// Thickness (px) of the chrome-drawn control strip carved off the panel's
/// page-facing edge — the drag/resize handle that also holds the dock-toggle
/// and close buttons. The native inspector webview sits just past it. The
/// frontend draws the strip into exactly this reserved band, so keep the two in
/// step (mirrored as `DEVTOOLS_STRIP` in App.tsx).
const DEVTOOLS_STRIP: f64 = 30.0;
/// Smallest slice (px) either the page or the panel may shrink to while docked.
const DEVTOOLS_MIN: f64 = 120.0;

/// Which edge the docked DevTools panel sits on.
#[derive(Clone, Copy, PartialEq)]
pub enum Dock {
    Bottom,
    Right,
}

/// State of the docked DevTools panel. `tab_id == None` means closed.
#[derive(Clone)]
pub struct Devtools {
    pub tab_id: Option<String>,
    pub dock: Dock,
    /// Fraction of the content area the panel occupies (clamped 0.15..0.85).
    pub size: f64,
}

impl Default for Devtools {
    fn default() -> Self {
        Self {
            tab_id: None,
            dock: Dock::Bottom,
            size: 0.35,
        }
    }
}

/// The remote-debugging port chosen at startup (see
/// `webext::enable_remote_debugging`), managed so the DevTools commands can
/// build the frontend URL. 0 means remote debugging is off (non-Windows).
pub struct DevtoolsPort(pub u16);

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
    /// The currently shown tab id (set by `activate_tab`; None for internal
    /// pages/overlays). The docked DevTools panel is visible only while this
    /// equals `devtools.tab_id`.
    pub active: Mutex<Option<String>>,
    pub devtools: Mutex<Devtools>,
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

/// Decide what a webview's new-window request (window.open / target="_blank" /
/// middle-click) should do, uniformly for tab pages and the extension popup.
///
/// - A genuine popup — window.open() called with an explicit size or position,
///   the way OAuth logins open a small centered window — must get a real window
///   handle back, or the page's postMessage-to-opener / popup.close() never
///   fires and the sign-in hangs. `Allow` lets WebView2 open its default popup
///   (SetHandled(false)), which returns a non-null handle and shares our
///   browsing profile/cookies.
/// - Plain target="_blank" and featureless window.open() carry no size/position
///   and become a foreground tab, like Chrome.
/// - A deep link (mailto:, steam://, …) is offered to the OS via the chrome UI.
pub(crate) fn route_new_window(
    app: &AppHandle,
    source_id: &str,
    url: &Url,
    features: &tauri::webview::NewWindowFeatures,
) -> NewWindowResponse<tauri::Wry> {
    eprintln!(
        "[UWB-PROBE] new-window src={source_id} url={url} size={:?} pos={:?}",
        features.size(),
        features.position()
    );
    match scheme_kind(url) {
        SchemeKind::Web => {
            if matches!(url.scheme(), "http" | "https")
                && (features.size().is_some() || features.position().is_some())
            {
                return NewWindowResponse::Allow;
            }
            open_in_new_tab(app, source_id, url);
            NewWindowResponse::Deny
        }
        SchemeKind::External => {
            emit_tab_event(app, source_id, "external-url", url.to_string());
            NewWindowResponse::Deny
        }
        SchemeKind::Internal => NewWindowResponse::Deny,
    }
}

/// How a URL relates to a tab webview.
#[derive(PartialEq, Clone, Copy)]
enum SchemeKind {
    /// A document the engine renders in the tab: web, local file, our uwb: pages.
    Web,
    /// A deep link into another app (mailto:, tel:, steam://, vscode://,
    /// slack://, magnet:, …). Not a document — Chrome hands these to the OS
    /// shell so the associated app launches. We do the same, behind a prompt.
    External,
    /// Engine-internal or inert schemes (about:, data:, javascript:, blob:,
    /// chrome:, view-source:). Chrome never shells these out and neither do we;
    /// they're simply refused as a top-frame load.
    Internal,
}

fn scheme_kind(url: &Url) -> SchemeKind {
    match url.scheme() {
        "http" | "https" | "file" | "uwb" => SchemeKind::Web,
        "about" | "blob" | "data" | "javascript" | "vbscript" | "chrome" | "edge"
        | "devtools" | "view-source" | "ws" | "wss" => SchemeKind::Internal,
        _ => SchemeKind::External,
    }
}

/// Only real navigable schemes plus our internal `uwb:` are allowed for the
/// user-driven `create_tab`/`navigate_tab` commands; anything else (javascript:,
/// data:, a raw deep link, …) is rejected here rather than trusting the frontend
/// to have normalized it. file: is deliberately in — local documents opened via
/// the OS file association or a typed path render like in any browser.
fn check_scheme(url: &Url) -> Result<(), String> {
    match scheme_kind(url) {
        SchemeKind::Web => Ok(()),
        _ => Err(format!("unsupported url scheme: {}", url.scheme())),
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

/// Given the full content rect and the DevTools config, return the page rect
/// (what tab webviews fill) and the native inspector rect (the panel minus its
/// control strip). The panel occupies `size` of the content along the docked
/// edge; both slices are clamped so neither collapses.
fn devtools_split(
    pos: LogicalPosition<f64>,
    size: LogicalSize<f64>,
    dt: &Devtools,
) -> (
    (LogicalPosition<f64>, LogicalSize<f64>),
    (LogicalPosition<f64>, LogicalSize<f64>),
) {
    let frac = dt.size.clamp(0.15, 0.85);
    match dt.dock {
        Dock::Bottom => {
            let panel_h = (size.height * frac).clamp(DEVTOOLS_MIN, (size.height - DEVTOOLS_MIN).max(DEVTOOLS_MIN));
            let page_h = (size.height - panel_h).max(1.0);
            let page = (pos, LogicalSize::new(size.width, page_h));
            let inspector = (
                LogicalPosition::new(pos.x, pos.y + page_h + DEVTOOLS_STRIP),
                LogicalSize::new(size.width, (panel_h - DEVTOOLS_STRIP).max(1.0)),
            );
            (page, inspector)
        }
        Dock::Right => {
            let panel_w = (size.width * frac).clamp(DEVTOOLS_MIN, (size.width - DEVTOOLS_MIN).max(DEVTOOLS_MIN));
            let page_w = (size.width - panel_w).max(1.0);
            let page = (pos, LogicalSize::new(page_w, size.height));
            let inspector = (
                LogicalPosition::new(pos.x + page_w + DEVTOOLS_STRIP, pos.y),
                LogicalSize::new((panel_w - DEVTOOLS_STRIP).max(1.0), size.height),
            );
            (page, inspector)
        }
    }
}

pub fn apply_bounds_to_all(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let state = app.state::<TabsState>();
    let insets = *state.insets.lock().unwrap_or_else(|e| e.into_inner());
    let Ok((pos, size)) = content_rect(&window, insets) else {
        return;
    };
    let dt = state.devtools.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let active = state.active.lock().unwrap_or_else(|e| e.into_inner()).clone();
    // The panel shows only when its bound tab is the one on screen.
    let showing = dt.tab_id.is_some() && dt.tab_id == active;

    // The rect tab webviews fill: the full content area, or the page slice when
    // the panel is docked over this tab.
    let ((page_pos, page_size), inspector) = if showing {
        devtools_split(pos, size, &dt)
    } else {
        ((pos, size), (pos, size))
    };
    for (label, webview) in app.webviews() {
        if label.starts_with(TAB_PREFIX) {
            let _ = webview.set_position(page_pos);
            let _ = webview.set_size(page_size);
        }
    }
    if let Some(panel) = app.get_webview(DEVTOOLS_LABEL) {
        if showing {
            let _ = panel.set_position(inspector.0);
            let _ = panel.set_size(inspector.1);
            let _ = panel.show();
        } else {
            let _ = panel.hide();
        }
    }
}

#[tauri::command]
pub async fn create_tab(
    app: AppHandle,
    state: tauri::State<'_, TabsState>,
    port: tauri::State<'_, DevtoolsPort>,
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
            eprintln!("[UWB-PROBE] on_navigation tab={id_nav} url={url}");
            // Main-frame only — iframes (ads, sandboxes) fire a different
            // WebView2 event and are unaffected, so legitimate about:blank
            // iframes still load.
            match scheme_kind(&url) {
                // A real document: allow it and report the address.
                SchemeKind::Web => {
                    emit_tab_event(&app_nav, &id_nav, "url", url.to_string());
                    true
                }
                // A deep link to another app (mailto:, steam://, …): cancel the
                // top-frame load (which would otherwise strand the tab on a
                // blank page) and offer to hand it to the OS, like Chrome.
                SchemeKind::External => {
                    emit_tab_event(&app_nav, &id_nav, "external-url", url.to_string());
                    false
                }
                // about:/data:/javascript: top-frame loads are inert or a
                // phishing vector Chrome blocks; refuse without prompting.
                SchemeKind::Internal => false,
            }
        })
        // window.open() / target="_blank" raise NewWindowRequested instead of
        // navigating; without a handler the engine silently drops the request.
        .on_new_window(move |url, features| route_new_window(&app_new, &id_new, &url, &features))
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
    // Enable Chromium remote debugging on the browsing-profile browser process
    // so the docked DevTools panel can attach. Must match the identical args on
    // every browsing-profile webview (ext host/popup) or WebView2 rejects the
    // mismatched environment.
    if let Some(args) = crate::webext::browsing_browser_args(port.0) {
        builder = builder.additional_browser_args(&args);
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
pub async fn close_tab(app: AppHandle, state: tauri::State<'_, TabsState>, id: String) -> Result<(), String> {
    // If the docked DevTools was inspecting this tab, unbind it so the panel
    // doesn't linger (it hides on the next layout).
    {
        let mut dt = state.devtools.lock().unwrap_or_else(|e| e.into_inner());
        if dt.tab_id.as_deref() == Some(id.as_str()) {
            dt.tab_id = None;
        }
    }
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    webview.close().map_err(|e| e.to_string())
}

/// Show the webview for `id`, hide every other tab webview.
/// Pass no id to hide all tabs (internal pages like the dashboard).
#[tauri::command]
pub async fn activate_tab(
    app: AppHandle,
    state: tauri::State<'_, TabsState>,
    id: Option<String>,
) -> Result<(), String> {
    // Record which tab is on screen so the layout knows whether the docked
    // DevTools panel (bound to a specific tab) should be visible.
    *state.active.lock().unwrap_or_else(|e| e.into_inner()) = id.clone();
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
    // Re-run geometry: give the shown tab the page slice (or full area) and
    // show/hide the DevTools panel to match the new active tab.
    apply_bounds_to_all(&app);
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

/// Open the native Chromium DevTools *floating window* for a tab. Kept as an
/// internal fallback; the UI drives the docked panel (`devtools_open`) instead.
#[tauri::command]
pub async fn tab_devtools(app: AppHandle, id: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    crate::webext::open_devtools(&webview);
    Ok(())
}

/// The DevTools frontend URL served by Chromium's remote-debugging endpoint,
/// pointed at a specific page target. Served over http (unlike `devtools://`,
/// which a child webview can't load), so it drops straight into a panel webview.
fn inspector_url(port: u16, target: &str) -> String {
    format!(
        "http://127.0.0.1:{port}/devtools/inspector.html?ws=127.0.0.1:{port}/devtools/page/{target}"
    )
}

/// Open (or re-target) the *docked* DevTools panel over tab `id` — the real
/// Chromium inspector embedded in a child webview whose bounds we control,
/// instead of WebView2's detached floating window. Resolves the tab's CDP
/// target, then creates the panel webview (first time) or navigates the reused
/// one, binds it to this tab, and lays out the split.
#[tauri::command]
pub async fn devtools_open(
    app: AppHandle,
    state: tauri::State<'_, TabsState>,
    port: tauri::State<'_, DevtoolsPort>,
    id: String,
) -> Result<(), String> {
    let port = port.0;
    if port == 0 {
        return Err("remote debugging is unavailable on this platform".into());
    }
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    let target = crate::webext::resolve_target_id(&webview)
        .ok_or("could not resolve the page's DevTools target")?;
    let parsed = Url::parse(&inspector_url(port, &target)).map_err(|e| e.to_string())?;

    state.devtools.lock().unwrap_or_else(|e| e.into_inner()).tab_id = Some(id.clone());

    if let Some(panel) = app.get_webview(DEVTOOLS_LABEL) {
        panel.navigate(parsed).map_err(|e| e.to_string())?;
    } else {
        let window = app.get_window("main").ok_or("main window not found")?;
        let insets = *state.insets.lock().unwrap_or_else(|e| e.into_inner());
        let (pos, size) = content_rect(&window, insets).map_err(|e| e.to_string())?;
        let dt = state.devtools.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let (_, inspector) = devtools_split(pos, size, &dt);
        let builder = tauri::webview::WebviewBuilder::new(DEVTOOLS_LABEL, WebviewUrl::External(parsed))
            // Hand drag back to WebView2 so the inspector's own draggable
            // dividers/resizers behave; no tab hooks so we don't intercept its
            // keys, and no extensions in the tools UI.
            .disable_drag_drop_handler();
        let panel = window
            .add_child(builder, inspector.0, inspector.1)
            .map_err(|e| e.to_string())?;
        // Fresh child webviews can stay blank until their bounds actually
        // change (see extensions.rs); nudge a first paint.
        crate::webext::force_repaint(&panel);
    }
    apply_bounds_to_all(&app);
    Ok(())
}

/// Hide the docked DevTools panel (unbinds it; the webview stays alive, hidden,
/// for fast reuse). The page reclaims the full content area.
#[tauri::command]
pub async fn devtools_close(
    app: AppHandle,
    state: tauri::State<'_, TabsState>,
) -> Result<(), String> {
    state.devtools.lock().unwrap_or_else(|e| e.into_inner()).tab_id = None;
    apply_bounds_to_all(&app);
    Ok(())
}

/// Switch the panel between bottom and right docking.
#[tauri::command]
pub async fn devtools_set_dock(
    app: AppHandle,
    state: tauri::State<'_, TabsState>,
    dock: String,
) -> Result<(), String> {
    let d = if dock == "right" { Dock::Right } else { Dock::Bottom };
    state.devtools.lock().unwrap_or_else(|e| e.into_inner()).dock = d;
    apply_bounds_to_all(&app);
    Ok(())
}

/// Resize the panel to `size` (fraction of the content area). Called by the
/// frontend's splitter drag on release.
#[tauri::command]
pub async fn devtools_set_size(
    app: AppHandle,
    state: tauri::State<'_, TabsState>,
    size: f64,
) -> Result<(), String> {
    state.devtools.lock().unwrap_or_else(|e| e.into_inner()).size = size.clamp(0.15, 0.85);
    apply_bounds_to_all(&app);
    Ok(())
}

/// Open WebView2's built-in print preview for a tab (Ctrl+P / toolbar), the
/// same browser print UI Chrome shows.
#[tauri::command]
pub async fn tab_print(app: AppHandle, id: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_label(&id))
        .ok_or("tab webview not found")?;
    crate::webext::print(&webview);
    Ok(())
}

/// Answer a permission prompt (camera/mic/geolocation/notifications/clipboard)
/// the chrome UI raised from a `permission` tab-event.
#[tauri::command]
pub async fn permission_respond(app: AppHandle, id: String, allow: bool) -> Result<(), String> {
    crate::webext::permission_respond(&app, id, allow);
    Ok(())
}

/// Answer an HTTP basic-auth prompt. Omit the credentials to cancel the load.
#[tauri::command]
pub async fn basic_auth_respond(
    app: AppHandle,
    id: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    crate::webext::basic_auth_respond(&app, id, username, password);
    Ok(())
}

/// Resolve a certificate-error interstitial: proceed anyway, or cancel.
#[tauri::command]
pub async fn cert_respond(app: AppHandle, id: String, proceed: bool) -> Result<(), String> {
    crate::webext::cert_respond(&app, id, proceed);
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

/// Hand a deep link (mailto:, tel:, steam://, vscode://, magnet:, …) to the OS
/// so the associated app launches — the same handoff Chrome does after its
/// "Open in another app?" prompt. The frontend gates this behind a confirm
/// dialog; we re-check the scheme here so a compromised frontend can't turn it
/// into an arbitrary file/URL launcher (only genuine external schemes pass —
/// never http/file/javascript/etc.).
#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    if scheme_kind(&parsed) != SchemeKind::External {
        return Err(format!("not an external scheme: {}", parsed.scheme()));
    }
    os_open(parsed.as_str())
}

/// Launch a URL through the OS shell's protocol association. Uses ShellExecuteW
/// on Windows (the injection-safe path — no cmd/start parsing), and the
/// platform opener elsewhere.
#[cfg(windows)]
fn os_open(url: &str) -> Result<(), String> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let file = HSTRING::from(url);
    // A return value > 32 means success (legacy ShellExecute contract).
    let hinst = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if hinst.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("no app is registered to open {url}"))
    }
}

#[cfg(not(windows))]
fn os_open(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(not(target_os = "macos"))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
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
