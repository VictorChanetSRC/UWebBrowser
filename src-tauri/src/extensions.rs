//! Chrome/WebView2 browser extensions (Windows only).
//!
//! WebView2 can run *real, unpacked* Chrome extensions natively: the engine
//! loads a folder per extension (`extensions_path` at webview creation, handled
//! by wry) and exposes them per browsing profile via `ICoreWebView2Profile7`.
//! Everything here lives in the tab webviews' `browsing` profile, shared by the
//! hidden host webview — so the chrome UI webview is never an extension host.
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

/// Largest CRX we'll download from the store. Real extensions bundle WASM,
/// locales and media and routinely exceed the 16 MiB feed cap in `http`, so the
/// store path gets its own (still bounded) ceiling — kept at/below the
/// decompressed cap in [`extract_zip`] so a download can't outgrow extraction.
const MAX_CRX: usize = 128 * 1024 * 1024;

/// Marker file dropped into a patched extension folder so we don't re-read and
/// regex-scan its entire JS tree on every launch. Its contents are
/// [`PATCH_VERSION`]; bump that when [`patch_js_file`]'s rewrite changes so a
/// stale marker forces a re-patch.
const PATCH_MARKER: &str = ".uwb-permpatch";
const PATCH_VERSION: &str = "1";

/// Outcome of a live `AddBrowserExtension` call, so a failed install surfaces an
/// error instead of a silent false success.
#[cfg(windows)]
enum AddOutcome {
    /// WebView2 registered the extension.
    Added,
    /// The call completed but WebView2 refused the folder (invalid or
    /// unsupported manifest). The freshly-written folder is safe to delete.
    Rejected,
    /// The call never completed — host missing, failed to start, or timed out.
    /// The extension may in fact be registered, so the folder is left in place.
    Unknown,
}

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

/// Join an extension-relative asset path under `dir`, refusing anything that
/// escapes the extension directory. A manifest is attacker-controlled (any
/// unpacked/CRX extension), so a value like `../../../secret` in an icon path
/// or a `../..`-laden `default_locale` must not let us read files outside the
/// extension. Both paths are canonicalized and the result must stay under
/// `dir`; returns `None` (skip the asset) otherwise.
fn safe_asset_path(dir: &std::path::Path, rel: &str) -> Option<std::path::PathBuf> {
    let rel = rel.trim_start_matches(['/', '\\']);
    let base = dir.canonicalize().ok()?;
    let full = base.join(rel).canonicalize().ok()?;
    full.starts_with(&base).then_some(full)
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
    let messages = safe_asset_path(dir, &format!("_locales/{locale}/messages.json"))?;
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
    // leading separator would make `join` treat them as absolute (C:\assets\…).
    // `safe_asset_path` strips it and rejects any `..` escape out of the
    // extension dir. Windows accepts the remaining forward slashes as-is.
    let path = safe_asset_path(dir, &rel)?;
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
                // Store installs name the folder by the (canonical) runtime id,
                // so match on that first — it's collision-proof, unlike the name,
                // which two extensions can share. Fall back to name/dir for
                // load-unpacked folders, whose name is path-derived.
                folders
                    .iter()
                    .find(|f| f.dir_name.eq_ignore_ascii_case(&id))
                    .or_else(|| {
                        folders.iter().find(|f| {
                            f.name.eq_ignore_ascii_case(&rname)
                                || f.dir_name.eq_ignore_ascii_case(&rname)
                        })
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
        BrowserExtensionRemoveCompletedHandler, ProfileAddBrowserExtensionCompletedHandler,
        ProfileGetBrowserExtensionsCompletedHandler,
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

    /// Install one unpacked extension folder into the live profile, resolving to
    /// the [`AddOutcome`] once WebView2 reports completion (or times out). On
    /// success WebView2 hands back the created extension; on rejection it passes
    /// a null one, which is how we tell a bad manifest from a slow success.
    pub async fn add_extension(app: &AppHandle, folder: PathBuf) -> AddOutcome {
        let Some(host) = app.get_webview(EXT_HOST_LABEL) else {
            return AddOutcome::Unknown;
        };
        let (tx, rx) = mpsc::channel::<AddOutcome>();
        let _ = host.with_webview(move |pw| unsafe {
            let started = (|| -> windows::core::Result<()> {
                let profile = profile7(&pw)?;
                let tx = tx.clone();
                let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
                    move |_hr, ext| {
                        let outcome = if ext.is_some() {
                            AddOutcome::Added
                        } else {
                            AddOutcome::Rejected
                        };
                        let _ = tx.send(outcome);
                        Ok(())
                    },
                ));
                profile.AddBrowserExtension(&HSTRING::from(folder.as_path()), &handler)?;
                Ok(())
            })();
            if started.is_err() {
                let _ = tx.send(AddOutcome::Unknown);
            }
        });
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(15))
                .unwrap_or(AddOutcome::Unknown)
        })
        .await
        .unwrap_or(AddOutcome::Unknown)
    }

    /// Remove the extension with the given runtime id from the live profile.
    /// Enumerates the installed set, matches by id, and calls `Remove` (a nested
    /// async callback), resolving once WebView2 reports completion.
    pub async fn remove_extension(app: &AppHandle, id: String) -> bool {
        let Some(host) = app.get_webview(EXT_HOST_LABEL) else {
            return false;
        };
        let (tx, rx) = mpsc::channel::<bool>();
        let _ = host.with_webview(move |pw| unsafe {
            let ran = (|| -> windows::core::Result<()> {
                let profile = profile7(&pw)?;
                let tx = tx.clone();
                let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
                    move |_hr, list| {
                        let mut removing = false;
                        if let Some(list) = list {
                            let mut count = 0u32;
                            if list.Count(&mut count).is_ok() {
                                for i in 0..count {
                                    let Ok(ext) = list.GetValueAtIndex(i) else {
                                        continue;
                                    };
                                    let mut pid = PWSTR::null();
                                    let _ = ext.Id(&mut pid);
                                    if take_pwstr(pid) != id {
                                        continue;
                                    }
                                    let tx = tx.clone();
                                    let done = BrowserExtensionRemoveCompletedHandler::create(
                                        Box::new(move |_hr| {
                                            let _ = tx.send(true);
                                            Ok(())
                                        }),
                                    );
                                    removing = ext.Remove(&done).is_ok();
                                    break;
                                }
                            }
                        }
                        // Nothing matched (or Remove failed to start): the remove
                        // handler will never fire, so resolve here instead.
                        if !removing {
                            let _ = tx.send(false);
                        }
                        Ok(())
                    },
                ));
                profile.GetBrowserExtensions(&handler)?;
                Ok(())
            })();
            if ran.is_err() {
                let _ = tx.send(false);
            }
        });
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(10)).unwrap_or(false)
        })
        .await
        .unwrap_or(false)
    }
}

// --- commands ---------------------------------------------------------------

/// The installed extensions, ready for the pinned bar.
#[tauri::command]
pub async fn ext_list(app: AppHandle) -> Result<Vec<ExtInfo>, String> {
    #[cfg(windows)]
    {
        // Self-heal: if the host webview never came up (or was torn down), the
        // profile can't be enumerated. Recreate it before querying so the bar
        // recovers instead of staying empty for the rest of the session.
        if app.get_webview(EXT_HOST_LABEL).is_none() {
            spawn_host(&app);
        }
        let folders = read_folder_infos(&app);
        let mut runtime = imp::query_installed(&app).await;
        // Cold start: WebView2 loads the `extensions_path` extensions into the
        // profile *asynchronously* after the host webview is created, so the
        // first GetBrowserExtensions can report fewer than are on disk (or none,
        // if the host webview isn't ready yet). Poll until the runtime set
        // matches what's on disk, bailing early once the count stops changing so
        // a single extension WebView2 refuses to load can't stall every call.
        // Installs go through AddBrowserExtension (which already awaits
        // registration), so this loop only does work at launch.
        if runtime.len() < folders.len() {
            let mut last = runtime.len();
            let mut stable = 0;
            for _ in 0..20 {
                let _ = tauri::async_runtime::spawn_blocking(|| {
                    std::thread::sleep(std::time::Duration::from_millis(150))
                })
                .await;
                runtime = imp::query_installed(&app).await;
                if runtime.len() >= folders.len() {
                    break;
                }
                if runtime.len() == last {
                    stable += 1;
                    if stable >= 4 {
                        break;
                    }
                } else {
                    stable = 0;
                    last = runtime.len();
                }
            }
        }
        Ok(merge(runtime, folders))
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
    add_or_cleanup(&app, dest).await?;
    #[cfg(not(windows))]
    let _ = dest;

    ext_list(app).await
}

/// Install a freshly-written extension folder into the live profile and turn the
/// outcome into a command result. A definitively-rejected folder is deleted so
/// it isn't re-scanned and retried on every launch; a folder whose install never
/// confirmed is left in place (it may actually have registered).
#[cfg(windows)]
async fn add_or_cleanup(app: &AppHandle, dest: PathBuf) -> Result<(), String> {
    match imp::add_extension(app, dest.clone()).await {
        AddOutcome::Added => Ok(()),
        AddOutcome::Rejected => {
            let _ = std::fs::remove_dir_all(&dest);
            Err("WebView2 refused that extension — its manifest may be invalid or unsupported"
                .to_string())
        }
        AddOutcome::Unknown => Err(
            "the extension didn't finish installing — reopen the extensions bar to check whether it loaded"
                .to_string(),
        ),
    }
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
    let resp = crate::http::shared()?
        .get(&url)
        .send()
        .await
        .map_err(crate::http::err)?
        .error_for_status()
        .map_err(crate::http::err)?;
    let bytes = crate::http::body_capped_max(resp, MAX_CRX).await?;

    let zip = crx_inner_zip(&bytes)?;
    // The CRX header carries the extension's public key. Pin it into the
    // manifest as `key` (below) so Chromium/WebView2 derives the *canonical*
    // Web Store id instead of a path-based one — pages that message the
    // extension by its store id (e.g. Proton's post-login fork) then reach it.
    let public_key = crx_public_key(&bytes, &id);
    let dir = extensions_dir(&app).ok_or("could not resolve the extensions folder")?;
    let dest = dir.join(&id);
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    extract_zip(zip, &dest)?;
    if let Some(key) = public_key {
        inject_manifest_key(&dest, &key);
    }
    patch_permission_gates(&dest);

    #[cfg(windows)]
    add_or_cleanup(&app, dest).await?;
    #[cfg(not(windows))]
    let _ = dest;

    ext_list(app).await
}

/// Uninstall an extension: remove it from the live WebView2 profile and delete
/// its on-disk folder (otherwise `extensions_path` reloads it next launch).
#[tauri::command]
pub async fn ext_uninstall(app: AppHandle, id: String) -> Result<Vec<ExtInfo>, String> {
    #[cfg(windows)]
    {
        // Learn the runtime name before removal so we can also match the folder
        // for load-unpacked extensions (whose folder isn't named by id).
        let name = imp::query_installed(&app)
            .await
            .into_iter()
            .find(|(rid, _)| *rid == id)
            .map(|(_, n)| n)
            .unwrap_or_default();
        imp::remove_extension(&app, id.clone()).await;
        remove_extension_folder(&app, &id, &name);
        // GetBrowserExtensions can still report the extension for a moment after
        // Remove resolves, so drop it from the returned list explicitly.
        let mut list = ext_list(app).await?;
        list.retain(|e| e.id != id);
        Ok(list)
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        ext_list(app).await
    }
}

/// Delete the folder backing an installed extension. Store installs are named by
/// their (now canonical) id; load-unpacked folders keep their source name, so
/// fall back to matching the manifest/dir name.
#[cfg(windows)]
fn remove_extension_folder(app: &AppHandle, id: &str, name: &str) {
    let Some(dir) = extensions_dir(app) else {
        return;
    };
    let by_id = dir.join(id);
    if by_id.is_dir() {
        let _ = std::fs::remove_dir_all(&by_id);
        return;
    }
    if name.is_empty() {
        return;
    }
    for folder in read_folder_infos(app) {
        if folder.name.eq_ignore_ascii_case(name) || folder.dir_name.eq_ignore_ascii_case(name) {
            let _ = std::fs::remove_dir_all(dir.join(&folder.dir_name));
            return;
        }
    }
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

    // Replace any popup already showing. `close()` is processed on the event
    // loop, not synchronously, so wait for the label to actually free up before
    // the `add_child` below reuses it — otherwise switching quickly between two
    // extensions races the still-live webview and the new popup fails to open.
    if let Some(existing) = app.get_webview(EXT_POPUP_LABEL) {
        let _ = existing.close();
        for _ in 0..30 {
            if app.get_webview(EXT_POPUP_LABEL).is_none() {
                break;
            }
            let _ = tauri::async_runtime::spawn_blocking(|| {
                std::thread::sleep(std::time::Duration::from_millis(10))
            })
            .await;
        }
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

    let w = width.max(120.0);
    let h = height.max(120.0);
    let popup_view = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(w, h),
        )
        .map_err(|e| e.to_string())?;
    // Fast path: usually lands immediately. The on_page_load handler above is
    // the reliability net for when this queued navigate loses the race.
    popup_view.navigate(parsed).map_err(|e| e.to_string())?;
    // A freshly-created child webview can stay blank in release builds until it
    // receives a size change — tab webviews get one from `apply_bounds_to_all`
    // right after creation, but the popup never did, so it only painted in dev
    // where `open_devtools` forced a relayout. Jiggle the size (a delta, not the
    // identical value, or WebView2 skips it) to force the first paint.
    let _ = popup_view.set_size(LogicalSize::new(w, h - 1.0));
    let _ = popup_view.set_size(LogicalSize::new(w, h));
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
    match window.add_child(
        builder,
        LogicalPosition::new(-4000.0, -4000.0),
        LogicalSize::new(1.0, 1.0),
    ) {
        Ok(host) => {
            let _ = host.hide();
        }
        // Without the host webview the profile can't be enumerated, so the bar
        // shows nothing (tabs still load extensions from disk). `ext_list`
        // retries this, so a transient failure self-heals on the next call.
        Err(e) => eprintln!("extension host webview failed to spawn: {e}"),
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
    // Already patched by a previous run at the current version? The rewrite is
    // idempotent and the edited files persist on disk, so skip re-reading and
    // regex-scanning the whole (often multi-MB) JS tree — this runs at every
    // launch for every installed extension, so the marker keeps startup cheap.
    let marker = dir.join(PATCH_MARKER);
    if std::fs::read_to_string(&marker).ok().as_deref() == Some(PATCH_VERSION) {
        return;
    }
    let _ = std::fs::remove_dir_all(dir.join("_metadata"));
    patch_js_tree(dir);
    let _ = std::fs::write(&marker, PATCH_VERSION);
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

/// Extract the extension's public key (DER `SubjectPublicKeyInfo`) from a CRX,
/// choosing the one that derives `expected_id`. Chromium derives the extension
/// id from this key, so pinning it into the manifest as `key` gives the unpacked
/// extension its canonical Web Store id.
///
/// A Web Store CRX3 is signed by *two* keys — the developer's and Google's
/// publisher key — so we can't just take the first proof; we pick the one whose
/// SHA-256 maps to the id we're installing.
fn crx_public_key(bytes: &[u8], expected_id: &str) -> Option<Vec<u8>> {
    if bytes.len() < 16 || &bytes[0..4] != b"Cr24" {
        return None;
    }
    let u32_at = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    match u32_at(4) {
        // CRX2: magic(4) version(4) pubkey_len(4) sig_len(4) key sig zip — one key.
        2 => {
            let pk_len = u32_at(8) as usize;
            bytes
                .get(16..16 + pk_len)
                .filter(|pk| id_from_public_key(pk) == expected_id)
                .map(<[u8]>::to_vec)
        }
        // CRX3: magic(4) version(4) header_len(4) header zip. The header is a
        // `CrxFileHeader` protobuf; each `sha256_with_rsa` (field 2) is an
        // `AsymmetricKeyProof` whose `public_key` (field 1) is a DER key.
        3 => {
            let header_len = u32_at(8) as usize;
            let header = bytes.get(12..12 + header_len)?;
            pb_len_fields(header, 2)
                .filter_map(|proof| pb_len_fields(proof, 1).next())
                .find(|pk| id_from_public_key(pk) == expected_id)
                .map(<[u8]>::to_vec)
        }
        _ => None,
    }
}

/// The Chromium extension id for a DER public key: the first 16 bytes of its
/// SHA-256, each nibble mapped `0..=15` → `'a'..='p'`.
fn id_from_public_key(public_key_der: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(public_key_der);
    let mut id = String::with_capacity(32);
    for &byte in &digest[..16] {
        id.push((b'a' + (byte >> 4)) as char);
        id.push((b'a' + (byte & 0x0f)) as char);
    }
    id
}

/// Iterate the bytes of every length-delimited (wire type 2) protobuf field
/// with the given number, skipping others. Minimal reader — only what a CRX3
/// header needs.
fn pb_len_fields(buf: &[u8], field: u64) -> impl Iterator<Item = &[u8]> {
    let mut buf = buf;
    std::iter::from_fn(move || {
        while !buf.is_empty() {
            let (tag, rest) = pb_varint(buf)?;
            buf = rest;
            match tag & 7 {
                // LEN
                2 => {
                    let (len, rest) = pb_varint(buf)?;
                    let val = rest.get(..len as usize)?;
                    buf = rest.get(len as usize..)?;
                    if tag >> 3 == field {
                        return Some(val);
                    }
                }
                // VARINT
                0 => buf = pb_varint(buf)?.1,
                // I64 / I32
                1 => buf = buf.get(8..)?,
                5 => buf = buf.get(4..)?,
                _ => return None,
            }
        }
        None
    })
}

/// Read a protobuf base-128 varint, returning it and the remaining slice.
fn pb_varint(buf: &[u8]) -> Option<(u64, &[u8])> {
    let mut val = 0u64;
    let mut shift = 0u32;
    for (i, &b) in buf.iter().enumerate() {
        val |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Some((val, &buf[i + 1..]));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

/// Write the extension's public key into its manifest as `key`, so Chromium
/// pins the canonical id. No-op if the manifest already declares a key.
fn inject_manifest_key(dir: &std::path::Path, public_key_der: &[u8]) {
    let path = dir.join("manifest.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(mut manifest) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(obj) = manifest.as_object_mut() else {
        return;
    };
    if obj.contains_key("key") {
        return;
    }
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(public_key_der);
    obj.insert("key".to_string(), serde_json::Value::String(b64));
    if let Ok(out) = serde_json::to_string_pretty(&manifest) {
        let _ = std::fs::write(&path, out);
    }
}

/// Unpack a ZIP (the CRX payload) into `dest`. `enclosed_name` rejects
/// traversal / absolute paths so a malicious archive can't escape the folder,
/// and the total *decompressed* output is capped so a zip bomb (or an
/// oversized store item) can't fill the disk. The cap is measured on bytes
/// actually written, not the header's declared sizes, so a lying header can't
/// bypass it.
fn extract_zip(zip_bytes: &[u8], dest: &std::path::Path) -> Result<(), String> {
    use std::io::Read;
    const MAX_TOTAL: u64 = 256 * 1024 * 1024;
    let reader = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    let mut written: u64 = 0;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = file.enclosed_name() else {
            continue;
        };
        let out = dest.join(rel);
        if file.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut sink = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        // Read at most the remaining budget (+1 so hitting the cap exactly still
        // trips the check on the next byte).
        let remaining = MAX_TOTAL.saturating_sub(written);
        let n = std::io::copy(&mut (&mut file).take(remaining + 1), &mut sink)
            .map_err(|e| e.to_string())?;
        written = written.saturating_add(n);
        if written > MAX_TOTAL {
            return Err("extension archive is too large".to_string());
        }
    }
    Ok(())
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        // `read_dir` doesn't follow symlinks, but `fs::copy`/recursion would:
        // skip them so a symlinked file/dir in an unpacked extension can't pull
        // content in from outside the picked folder.
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
