//! Chrome/WebView2 browser extensions (Windows only).
//!
//! WebView2 can run *real, unpacked* Chrome extensions natively: the engine
//! loads a folder per extension (`extensions_path` at webview creation, handled
//! by wry) and exposes them per browsing profile via `ICoreWebView2Profile7`.
//! Everything here lives in the tab webviews' `browsing` profile — the same one
//! the password manager uses — so the chrome UI webview is never extension-host.
//!
//! Two things the engine does *not* give us, which this module adds:
//!
//! * **Enumeration + IDs.** `AddBrowserExtension` assigns each extension a
//!   runtime id; the popup lives at `chrome-extension://<id>/<popup>`. We read
//!   the installed set back with `GetBrowserExtensions` (via a hidden `ext-host`
//!   webview that anchors the profile even with no tabs open) and correlate each
//!   to its source folder to recover the popup path and icon.
//! * **A UI.** WebView2 renders no toolbar button or popup. The chrome UI draws
//!   the pinned bar; clicking an entry asks [`ext_open_popup`] to float the
//!   extension's popup page as a child webview anchored under the bar.
//!
//! On non-Windows targets the commands compile to empty stubs.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

pub const EXT_HOST_LABEL: &str = "ext-host";
pub const EXT_POPUP_LABEL: &str = "ext-popup";

/// Passed to Google's CRX endpoint as `prodversion`. It only has to be a
/// plausible Chrome version for the download to be served; bump occasionally.
const CHROME_VERSION: &str = "131.0.6778.86";

/// One installed extension, as the pinned bar needs it.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtInfo {
    /// WebView2's runtime id — the authority in `chrome-extension://<id>/…`.
    pub id: String,
    pub name: String,
    /// Relative popup page from the manifest's action, if any. None → the
    /// extension has no browser-action popup (clicking it does nothing useful).
    pub popup: Option<String>,
    /// The action/toolbar icon as a `data:` URI, read straight from the folder
    /// (the chrome webview can't load `chrome-extension://` icons itself).
    pub icon: Option<String>,
    pub enabled: bool,
}

/// The folder that backs the on-disk extension store. Each immediate subfolder
/// is one unpacked extension. Created on demand so `extensions_path` always
/// points at a real directory.
pub fn extensions_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?.join("extensions");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

// --- manifest parsing (cross-platform) --------------------------------------

/// What we can learn about an extension from its folder alone.
struct FolderInfo {
    dir_name: String,
    name: String,
    popup: Option<String>,
    icon: Option<String>,
}

fn read_folder_infos(app: &AppHandle) -> Vec<FolderInfo> {
    let Some(dir) = extensions_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let Ok(text) = std::fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let dir_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        out.push(FolderInfo {
            name: resolve_name(&path, &manifest).unwrap_or_else(|| dir_name.clone()),
            popup: popup_path(&manifest),
            icon: icon_data_uri(&path, &manifest),
            dir_name,
        });
    }
    out
}

/// The manifest name, resolving a `__MSG_key__` i18n placeholder against the
/// default locale's `messages.json`.
fn resolve_name(dir: &std::path::Path, manifest: &serde_json::Value) -> Option<String> {
    let raw = manifest.get("name")?.as_str()?.trim();
    let key = raw
        .strip_prefix("__MSG_")
        .and_then(|s| s.strip_suffix("__"));
    let Some(key) = key else {
        return Some(raw.to_string());
    };
    let locale = manifest
        .get("default_locale")
        .and_then(|v| v.as_str())
        .unwrap_or("en");
    let messages = dir.join("_locales").join(locale).join("messages.json");
    let text = std::fs::read_to_string(messages).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    // Message keys are matched case-insensitively by Chrome.
    let msg = json
        .as_object()?
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .and_then(|(_, v)| v.get("message"))
        .and_then(|v| v.as_str())?;
    Some(msg.to_string())
}

/// MV3 `action.default_popup` or MV2 `browser_action.default_popup`.
fn popup_path(manifest: &serde_json::Value) -> Option<String> {
    for key in ["action", "browser_action"] {
        if let Some(popup) = manifest
            .get(key)
            .and_then(|a| a.get("default_popup"))
            .and_then(|v| v.as_str())
        {
            if !popup.is_empty() {
                return Some(popup.trim_start_matches('/').to_string());
            }
        }
    }
    None
}

/// Pick an icon (largest available, capped so we don't inline a huge asset) and
/// return it as a `data:` URI. Looks at the action's `default_icon` first, then
/// the top-level `icons` map.
fn icon_data_uri(dir: &std::path::Path, manifest: &serde_json::Value) -> Option<String> {
    let mut best: Option<(u32, String)> = None;
    let mut consider = |size: u32, rel: &str| {
        if rel.is_empty() {
            return;
        }
        // Prefer the largest icon no bigger than 128px; fall back to whatever
        // exists if everything is larger.
        let ranked = if size <= 128 { size } else { 128u32.saturating_sub(size / 100) };
        if best.as_ref().map_or(true, |(b, _)| ranked > *b) {
            best = Some((ranked, rel.to_string()));
        }
    };

    let icon_sources = [
        manifest.get("action").and_then(|a| a.get("default_icon")),
        manifest.get("browser_action").and_then(|a| a.get("default_icon")),
        manifest.get("icons"),
    ];
    for source in icon_sources.into_iter().flatten() {
        match source {
            // "default_icon": "icon.png"
            serde_json::Value::String(rel) => consider(32, rel),
            // "icons": { "16": "...", "128": "..." }
            serde_json::Value::Object(map) => {
                for (size, rel) in map {
                    if let Some(rel) = rel.as_str() {
                        consider(size.parse().unwrap_or(0), rel);
                    }
                }
            }
            _ => {}
        }
    }

    let (_, rel) = best?;
    // Extension asset paths are root-relative and often start with `/`; a
    // leading separator would make `join` treat them as absolute (C:\assets\…),
    // so strip it. Windows accepts the remaining forward slashes as-is.
    let path = dir.join(rel.trim_start_matches(['/', '\\']));
    let bytes = std::fs::read(&path).ok()?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("svg") => "image/svg+xml",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "image/png",
    };
    Some(format!("data:{mime};base64,{b64}"))
}

/// Merge the runtime `(id, name)` set with per-folder manifest data.
fn merge(runtime: Vec<(String, String)>, folders: Vec<FolderInfo>) -> Vec<ExtInfo> {
    // With exactly one of each, pair them regardless of name — covers
    // extensions whose runtime locale differs from their default_locale.
    let single_pair = runtime.len() == 1 && folders.len() == 1;
    runtime
        .into_iter()
        .map(|(id, rname)| {
            let folder = if single_pair {
                folders.first()
            } else {
                folders.iter().find(|f| {
                    f.name.eq_ignore_ascii_case(&rname) || f.dir_name.eq_ignore_ascii_case(&rname)
                })
            };
            ExtInfo {
                name: if rname.is_empty() {
                    folder.map(|f| f.name.clone()).unwrap_or_default()
                } else {
                    rname
                },
                popup: folder.and_then(|f| f.popup.clone()),
                icon: folder.and_then(|f| f.icon.clone()),
                enabled: true,
                id,
            }
        })
        .collect()
}

// --- Windows implementation -------------------------------------------------

#[cfg(windows)]
mod imp {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile7, ICoreWebView2_13,
    };
    use webview2_com::{
        ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
    };
    use windows::core::{Interface, HSTRING, PWSTR};

    /// Free a `PWSTR` the callee allocated with `CoTaskMemAlloc`, returning its
    /// contents as a `String`.
    unsafe fn take_pwstr(p: PWSTR) -> String {
        if p.is_null() {
            return String::new();
        }
        let s = p.to_string().ok().unwrap_or_default();
        windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const core::ffi::c_void));
        s
    }

    /// Grab the `browsing`-profile `ICoreWebView2Profile7` from the host webview.
    unsafe fn profile7(pw: &tauri::webview::PlatformWebview) -> windows::core::Result<ICoreWebView2Profile7> {
        let core = pw.controller().CoreWebView2()?;
        let core13: ICoreWebView2_13 = core.cast()?;
        core13.Profile()?.cast()
    }

    /// Enumerate installed extensions as `(id, name)`. Blocks (with a timeout)
    /// on the async WebView2 callback, so call it off the UI thread.
    pub async fn query_installed(app: &AppHandle) -> Vec<(String, String)> {
        let Some(host) = app.get_webview(EXT_HOST_LABEL) else {
            return Vec::new();
        };
        let (tx, rx) = mpsc::channel::<Vec<(String, String)>>();
        let _ = host.with_webview(move |pw| unsafe {
            let ran = (|| -> windows::core::Result<()> {
                let profile = profile7(&pw)?;
                let tx = tx.clone();
                let handler =
                    ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |_hr, list| {
                        let mut out = Vec::new();
                        if let Some(list) = list {
                            let mut count = 0u32;
                            if list.Count(&mut count).is_ok() {
                                for i in 0..count {
                                    if let Ok(ext) = list.GetValueAtIndex(i) {
                                        let mut id = PWSTR::null();
                                        let mut name = PWSTR::null();
                                        let _ = ext.Id(&mut id);
                                        let _ = ext.Name(&mut name);
                                        out.push((take_pwstr(id), take_pwstr(name)));
                                    }
                                }
                            }
                        }
                        let _ = tx.send(out);
                        Ok(())
                    }));
                profile.GetBrowserExtensions(&handler)?;
                Ok(())
            })();
            if ran.is_err() {
                // The handler (which owns the only clone that would fire) never
                // ran, so signal the empty result here rather than time out.
                let _ = tx.send(Vec::new());
            }
        });
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(5)).unwrap_or_default()
        })
        .await
        .unwrap_or_default()
    }

    /// Install one unpacked extension folder into the live profile, resolving
    /// once WebView2 reports completion.
    pub async fn add_extension(app: &AppHandle, folder: PathBuf) {
        let Some(host) = app.get_webview(EXT_HOST_LABEL) else {
            return;
        };
        let (tx, rx) = mpsc::channel::<bool>();
        let _ = host.with_webview(move |pw| unsafe {
            let started = (|| -> windows::core::Result<()> {
                let profile = profile7(&pw)?;
                let tx = tx.clone();
                let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
                    move |_hr, _ext| {
                        let _ = tx.send(true);
                        Ok(())
                    },
                ));
                profile.AddBrowserExtension(&HSTRING::from(folder.as_path()), &handler)?;
                Ok(())
            })();
            if started.is_err() {
                let _ = tx.send(false);
            }
        });
        let _ = tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(15))
        })
        .await;
    }
}

// --- commands ---------------------------------------------------------------

/// The installed extensions, ready for the pinned bar.
#[tauri::command]
pub async fn ext_list(app: AppHandle) -> Result<Vec<ExtInfo>, String> {
    #[cfg(windows)]
    {
        let runtime = imp::query_installed(&app).await;
        Ok(merge(runtime, read_folder_infos(&app)))
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

/// Copy an unpacked extension folder into the store and install it live.
#[tauri::command]
pub async fn ext_import(app: AppHandle, source: String) -> Result<Vec<ExtInfo>, String> {
    let source = PathBuf::from(source);
    if !source.join("manifest.json").is_file() {
        return Err("that folder has no manifest.json — pick an unpacked extension".to_string());
    }
    let dir = extensions_dir(&app).ok_or("could not resolve the extensions folder")?;
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("bad folder name")?;
    let dest = dir.join(name);
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    copy_dir_all(&source, &dest).map_err(|e| e.to_string())?;
    patch_permission_gates(&dest);

    #[cfg(windows)]
    imp::add_extension(&app, dest).await;
    #[cfg(not(windows))]
    let _ = dest;

    ext_list(app).await
}

/// Install an extension straight from the Chrome Web Store by id — the same
/// on-demand CRX endpoint Chromium's `webstorePrivate` uses when you click
/// "Add to Chrome". We fetch it ourselves (WebView2 exposes no store handshake),
/// unwrap the CRX to its inner ZIP, unpack it, and install it live.
#[tauri::command]
pub async fn ext_install_from_store(app: AppHandle, id: String) -> Result<Vec<ExtInfo>, String> {
    let id = id.trim().to_ascii_lowercase();
    // Web Store ids are 32 chars in the mpdecimal alphabet (a–p).
    if id.len() != 32 || !id.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
        return Err("that isn't a Chrome Web Store extension id".to_string());
    }

    let url = format!(
        "https://clients2.google.com/service/update2/crx\
         ?response=redirect&acceptformat=crx2,crx3&prodversion={CHROME_VERSION}\
         &x=id%3D{id}%26installsource%3Dondemand%26uc"
    );
    let bytes = crate::http::shared()?
        .get(&url)
        .send()
        .await
        .map_err(crate::http::err)?
        .error_for_status()
        .map_err(crate::http::err)?
        .bytes()
        .await
        .map_err(crate::http::err)?;

    let zip = crx_inner_zip(&bytes)?;
    let dir = extensions_dir(&app).ok_or("could not resolve the extensions folder")?;
    let dest = dir.join(&id);
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    extract_zip(zip, &dest)?;
    patch_permission_gates(&dest);

    #[cfg(windows)]
    imp::add_extension(&app, dest).await;
    #[cfg(not(windows))]
    let _ = dest;

    ext_list(app).await
}

/// Float an extension's popup page as a child webview anchored under the bar.
/// Coordinates and size are logical pixels supplied by the chrome UI.
#[tauri::command]
pub async fn ext_open_popup(
    app: AppHandle,
    id: String,
    popup: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use tauri::webview::{NewWindowResponse, PageLoadEvent};
    use tauri::{LogicalPosition, LogicalSize, Url, WebviewUrl};

    // Guard against a bad runtime id: an empty/short id yields
    // `chrome-extension:///…`, which WebView2 can't resolve and silently
    // replaces with its new-tab page (chrome-search://local-ntp).
    let id = id.trim();
    if id.len() != 32 || !id.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
        return Err(format!("extension id looks wrong ({id:?})"));
    }
    let popup = popup.trim().trim_start_matches('/');
    if popup.is_empty() {
        return Err("this extension has no popup page".to_string());
    }

    // Replace any popup already showing.
    if let Some(existing) = app.get_webview(EXT_POPUP_LABEL) {
        let _ = existing.close();
    }

    let window = app.get_window("main").ok_or("main window not found")?;
    let target = format!("chrome-extension://{id}/{popup}");
    let parsed = Url::parse(&target).map_err(|e| e.to_string())?;

    // Start at about:blank and navigate afterward: WebView2 rejects a
    // chrome-extension:// URL as a webview's *initial* source and falls back to
    // its new-tab page, but a post-creation navigation to it resolves fine.
    let blank = Url::parse("about:blank").map_err(|e| e.to_string())?;
    // Redo the navigation from the placeholder's page-load event. This command
    // runs off the main thread, so the eager `navigate()` below is only *queued*
    // (see send_user_message in tauri-runtime-wry) and races the webview's
    // initial about:blank load — in release builds it loses that race and the
    // popup stays blank (it only appeared to work in dev because the extra
    // queued open_devtools message shifted the timing). This callback fires on
    // the main thread once about:blank is live, so its navigate always lands.
    let nav_target = parsed.clone();
    let app_new = app.clone();
    let mut builder =
        tauri::webview::WebviewBuilder::new(EXT_POPUP_LABEL, WebviewUrl::External(blank))
            .browser_extensions_enabled(true)
            .disable_drag_drop_handler()
            .on_page_load(move |webview, payload| {
                if matches!(payload.event(), PageLoadEvent::Finished)
                    && payload.url().scheme() == "about"
                {
                    let _ = webview.navigate(nav_target.clone());
                }
            })
            // The popup's "sign in" buttons open the auth page via
            // window.open/chrome.tabs.create; without a handler WebView2 drops
            // the request (why sign-in did nothing). Route it to a real tab —
            // switching tabs dismisses this popup, and the shared profile means
            // the login it completes unlocks the extension here.
            .on_new_window(move |url, _features| {
                crate::tabs::open_in_new_tab(&app_new, EXT_POPUP_LABEL, &url);
                NewWindowResponse::Deny
            });
    // Share the tab profile so the popup and the content scripts see the same
    // extension background/storage (this is what lets a login in the popup
    // unlock autofill on the page).
    if let Some(dir) = crate::tabs::browsing_data_dir(&app) {
        builder = builder.data_directory(dir);
    }
    if let Some(dir) = extensions_dir(&app) {
        builder = builder.extensions_path(dir);
    }

    let popup_view = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(120.0), height.max(120.0)),
        )
        .map_err(|e| e.to_string())?;
    // Fast path: usually lands immediately. The on_page_load handler above is
    // the reliability net for when this queued navigate loses the race.
    popup_view.navigate(parsed).map_err(|e| e.to_string())?;
    // Dev-only: surface the popup's console so a blank extension page (usually a
    // service-worker/`chrome.runtime` failure) can be diagnosed.
    #[cfg(debug_assertions)]
    popup_view.open_devtools();
    Ok(())
}

/// Dismiss the floating popup, if any.
#[tauri::command]
pub async fn ext_close_popup(app: AppHandle) -> Result<(), String> {
    if let Some(popup) = app.get_webview(EXT_POPUP_LABEL) {
        popup.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- setup ------------------------------------------------------------------

/// Create the hidden host webview that anchors the extension profile so it can
/// be enumerated with no tab open. Extensions install into this profile at
/// creation (via `extensions_path`) and persist across launches.
pub fn spawn_host(app: &AppHandle) {
    use tauri::{LogicalPosition, LogicalSize, Url, WebviewUrl};

    let Some(window) = app.get_window("main") else {
        return;
    };
    // Heal extensions installed before the permission-gate shim existed, before
    // WebView2 re-reads them from disk when this host webview creates the profile.
    patch_all_installed(app);
    let Ok(blank) = Url::parse("about:blank") else {
        return;
    };
    let mut builder =
        tauri::webview::WebviewBuilder::new(EXT_HOST_LABEL, WebviewUrl::External(blank))
            .browser_extensions_enabled(true);
    if let Some(dir) = crate::tabs::browsing_data_dir(app) {
        builder = builder.data_directory(dir);
    }
    if let Some(dir) = extensions_dir(app) {
        builder = builder.extensions_path(dir);
    }
    // Parked offscreen at 1×1; hidden right after so it never paints.
    if let Ok(host) = window.add_child(
        builder,
        LogicalPosition::new(-4000.0, -4000.0),
        LogicalSize::new(1.0, 1.0),
    ) {
        let _ = host.hide();
    }
}

// --- helpers ----------------------------------------------------------------

/// WebView2 quirk: some extensions gate their features on
/// `chrome.permissions.contains({origins:[…]})`, which WebView2 wrongly reports
/// as `false` for a manifest's *required* host permissions — even though it has
/// granted them and content scripts do run. Proton Pass (and most password
/// managers) then self-disable with a "missing permissions" banner. Rewrite that
/// one check to resolve `true`; the page access it's asserting genuinely exists.
///
/// Applied to unpacked extensions on this machine only. Also strips `_metadata`
/// so an edited unpacked extension carries no stale store integrity hashes.
fn patch_permission_gates(dir: &std::path::Path) {
    let _ = std::fs::remove_dir_all(dir.join("_metadata"));
    patch_js_tree(dir);
}

fn patch_js_tree(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            patch_js_tree(&path);
        } else if path.extension().and_then(|e| e.to_str()) == Some("js") {
            patch_js_file(&path);
        }
    }
}

fn patch_js_file(path: &std::path::Path) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    // Cheap guard so we don't regex-scan every crypto/worker chunk.
    if !text.contains("permissions.contains({origins:") {
        return;
    }
    // Consume an optional receiver (`rp.`, `chrome.`, `globalThis.chrome.` → the
    // trailing `chrome.`) so the whole call expression is replaced cleanly.
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"(?:[\w$]+\.)?permissions\.contains\(\{origins:[^}]*\}\)").unwrap()
    });
    let patched = re.replace_all(&text, "Promise.resolve(!0)");
    if patched != text {
        let _ = std::fs::write(path, patched.as_ref());
    }
}

/// Re-apply [`patch_permission_gates`] to every installed extension. Unpacked
/// extensions are re-read from disk each launch, so running this before the
/// host webview loads them heals extensions installed before the shim existed.
pub fn patch_all_installed(app: &AppHandle) {
    let Some(dir) = extensions_dir(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            patch_permission_gates(&path);
        }
    }
}

/// A `.crx` is a signed header followed by a plain ZIP. Return the inner ZIP
/// slice, handling both CRX2 (legacy) and CRX3 (current) layouts.
fn crx_inner_zip(bytes: &[u8]) -> Result<&[u8], String> {
    if bytes.len() < 16 || &bytes[0..4] != b"Cr24" {
        return Err(
            "the download wasn't a CRX (the store may have returned nothing for that id)"
                .to_string(),
        );
    }
    let u32_at = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    let zip_start = match u32_at(4) {
        // CRX2: magic(4) version(4) pubkey_len(4) sig_len(4) key sig zip
        2 => 16 + u32_at(8) as usize + u32_at(12) as usize,
        // CRX3: magic(4) version(4) header_len(4) header zip
        3 => 12 + u32_at(8) as usize,
        other => return Err(format!("unsupported CRX version {other}")),
    };
    bytes
        .get(zip_start..)
        .filter(|z| z.len() >= 4)
        .ok_or_else(|| "the CRX was truncated".to_string())
}

/// Unpack a ZIP (the CRX payload) into `dest`. The `zip` crate rejects
/// traversal paths, so a malicious archive can't escape the folder.
fn extract_zip(zip_bytes: &[u8], dest: &std::path::Path) -> Result<(), String> {
    let reader = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    archive.extract(dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
