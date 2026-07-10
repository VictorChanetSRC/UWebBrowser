//! Native WebView2 wiring that Tauri/wry doesn't surface, applied per tab
//! webview: keyboard-accelerator forwarding, renderer-crash detection, native
//! page zoom, and the page's real favicon.
//!
//! Why accelerator forwarding exists: browser shortcuts (Ctrl+T/W/L, Ctrl+Tab,
//! F5, Alt+←/→, …) are bound on the *chrome* webview's DOM. When a native tab
//! webview holds OS keyboard focus — i.e. any time the user is looking at a page
//! — those keystrokes go to the page and never reach the chrome listener, so the
//! shortcuts silently die. WebView2 raises `AcceleratorKeyPressed` on the
//! controller for exactly these chord keys *before* the page sees them; we mark
//! the ones we own as handled (so the page doesn't also act on them) and forward
//! an action to the chrome UI, which runs the same handler as a real keypress.
//!
//! On non-Windows targets everything here compiles to no-ops.

use tauri::{AppHandle, Webview};

/// Wire a freshly-created tab webview to the native events above. `id` is the
/// tab id used in `tab-event` payloads back to the chrome UI.
#[cfg(windows)]
pub fn install_tab_hooks(app: &AppHandle, webview: &Webview, id: &str) {
    let app = app.clone();
    let id = id.to_string();
    let _ = webview.with_webview(move |pw| unsafe {
        imp::install(&app, &id, &pw);
    });
}

#[cfg(not(windows))]
pub fn install_tab_hooks(_app: &AppHandle, _webview: &Webview, _id: &str) {}

/// Set the zoom factor (1.0 == 100%) on a tab webview's controller.
#[cfg(windows)]
pub fn set_zoom(webview: &Webview, factor: f64) {
    let _ = webview.with_webview(move |pw| unsafe {
        let _ = pw.controller().SetZoomFactor(factor);
    });
}

/// Force a first paint on a freshly-created child webview that WebView2 can
/// leave blank until its controller bounds actually change. Nudges the *native*
/// controller bounds by 1px and back, synchronously on the UI thread — a Tauri
/// `set_size` pair coalesces to no net change and gets skipped. No-op off
/// Windows.
#[cfg(windows)]
pub fn force_repaint(webview: &Webview) {
    let _ = webview.with_webview(|pw| unsafe { imp::force_repaint(&pw) });
}

#[cfg(not(windows))]
pub fn force_repaint(_webview: &Webview) {}

#[cfg(not(windows))]
pub fn set_zoom(_webview: &Webview, _factor: f64) {}

/// Best-effort suspend of a backgrounded tab's renderer (frees its working set;
/// state is preserved and restored by [`resume`]). No-op if the runtime is too
/// old or the tab can't be suspended (e.g. active media/downloads).
#[cfg(windows)]
pub fn suspend(webview: &Webview) {
    let _ = webview.with_webview(|pw| unsafe { imp::suspend(&pw) });
}

#[cfg(not(windows))]
pub fn suspend(_webview: &Webview) {}

/// Wake a previously-suspended tab. Cheap and state-preserving (unlike a
/// discard, which would reload). Safe to call on a tab that wasn't suspended.
#[cfg(windows)]
pub fn resume(webview: &Webview) {
    let _ = webview.with_webview(|pw| unsafe { imp::resume(&pw) });
}

#[cfg(not(windows))]
pub fn resume(_webview: &Webview) {}

/// Open the native Chromium DevTools window for a tab webview — the real
/// Elements/Console/Network/Sources inspector, same as Chrome. Opens as its own
/// OS window (WebView2 has no docked mode). Kept as an internal fallback; the UI
/// drives the *docked* panel instead (see `enable_remote_debugging`). No-op off
/// Windows.
#[cfg(windows)]
pub fn open_devtools(webview: &Webview) {
    let _ = webview.with_webview(|pw| unsafe { imp::open_devtools(&pw) });
}

#[cfg(not(windows))]
pub fn open_devtools(_webview: &Webview) {}

/// Pick a free loopback port for Chromium's remote-debugging endpoint — the
/// endpoint that serves the *real* DevTools frontend we embed in a docked panel
/// (the only way WebView2 exposes it; there is no docked-mode API). Binds :0 to
/// let the OS hand us a free port, then drops the listener so Chromium can claim
/// it. Returns 0 off Windows / on failure. The port is handed to
/// [`browsing_browser_args`], which is what actually enables debugging.
#[cfg(windows)]
pub fn pick_debug_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(0)
}

#[cfg(not(windows))]
pub fn pick_debug_port() -> u16 {
    0
}

/// WebView2 browser arguments for the shared **browsing** profile: wry's own
/// defaults (which we must reproduce, since setting `additional_browser_args`
/// *replaces* them) plus the remote-debugging flags that let us load the docked
/// DevTools frontend. `--remote-allow-origins` is required since Chromium M111
/// for the frontend's WebSocket handshake; we scope it to the frontend origin.
///
/// Every webview on the browsing profile (tabs, the extension host, the
/// extension popup) MUST pass the *identical* string — WebView2 coalesces all
/// webviews sharing a user-data folder into one browser process and rejects a
/// later environment whose options don't match the running one. Returns None
/// when debugging is off (port 0 / non-Windows), so callers leave wry's default
/// in place. Note the env var `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` can't be
/// used here: wry always sets the arguments via the API, which takes precedence.
pub fn browsing_browser_args(port: u16) -> Option<String> {
    if port == 0 {
        return None;
    }
    Some(format!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
         --remote-debugging-port={port} --remote-allow-origins=http://127.0.0.1:{port}"
    ))
}

/// Resolve the CDP *target id* of a tab webview's page — the id used to build
/// its DevTools frontend URL (`.../devtools/page/<id>`). Asks the page over CDP
/// (`Target.getTargetInfo`), which is exact even when several tabs share a URL.
/// The COM completion callback fires later on the UI thread, so we bridge it
/// back to this (worker-thread) caller through a channel with a short timeout.
/// Returns None off Windows / on failure.
#[cfg(windows)]
pub fn resolve_target_id(webview: &Webview) -> Option<String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel::<String>();
    let _ = webview.with_webview(move |pw| unsafe { imp::resolve_target_id(&pw, tx) });
    rx.recv_timeout(std::time::Duration::from_secs(3))
        .ok()
        .filter(|s| !s.is_empty())
}

#[cfg(not(windows))]
pub fn resolve_target_id(_webview: &Webview) -> Option<String> {
    None
}

/// Cancel an in-progress download by its id. The WebView2 download operation has
/// thread affinity to the UI thread where it was created, so the cancel is
/// marshaled there (commands run on an async worker). No-op off Windows.
#[cfg(windows)]
pub fn cancel_download(app: &AppHandle, id: String) {
    let _ = app.run_on_main_thread(move || imp::cancel_download(&id));
}

#[cfg(not(windows))]
pub fn cancel_download(_app: &AppHandle, _id: String) {}

/// Open WebView2's built-in print preview for a tab (Ctrl+P), the browser one
/// that matches Chrome. No-op off Windows.
#[cfg(windows)]
pub fn print(webview: &Webview) {
    let _ = webview.with_webview(|pw| unsafe { imp::print(&pw) });
}

#[cfg(not(windows))]
pub fn print(_webview: &Webview) {}

/// Resolve a pending permission prompt. The COM args have UI-thread affinity,
/// so the answer is marshaled onto the main thread (commands run on a worker).
#[cfg(windows)]
pub fn permission_respond(app: &AppHandle, id: String, allow: bool) {
    let _ = app.run_on_main_thread(move || imp::permission_respond(&id, allow));
}

#[cfg(not(windows))]
pub fn permission_respond(_app: &AppHandle, _id: String, _allow: bool) {}

/// Resolve a pending HTTP basic-auth prompt with credentials, or cancel it.
#[cfg(windows)]
pub fn basic_auth_respond(
    app: &AppHandle,
    id: String,
    username: Option<String>,
    password: Option<String>,
) {
    let _ = app.run_on_main_thread(move || imp::basic_auth_respond(&id, username, password));
}

#[cfg(not(windows))]
pub fn basic_auth_respond(
    _app: &AppHandle,
    _id: String,
    _username: Option<String>,
    _password: Option<String>,
) {
}

/// Resolve a certificate-error interstitial (proceed anyway, or cancel).
#[cfg(windows)]
pub fn cert_respond(app: &AppHandle, id: String, proceed: bool) {
    let _ = app.run_on_main_thread(move || imp::cert_respond(&id, proceed));
}

#[cfg(not(windows))]
pub fn cert_respond(_app: &AppHandle, _id: String, _proceed: bool) {}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2BasicAuthenticationRequestedEventArgs, ICoreWebView2Controller,
        ICoreWebView2Deferral, ICoreWebView2DownloadOperation,
        ICoreWebView2PermissionRequestedEventArgs,
        ICoreWebView2ServerCertificateErrorDetectedEventArgs, ICoreWebView2_10, ICoreWebView2_14,
        ICoreWebView2_15, ICoreWebView2_16, ICoreWebView2_3, ICoreWebView2_4,
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE,
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED, COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED,
        COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ,
        COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        COREWEBVIEW2_PERMISSION_STATE_DEFAULT, COREWEBVIEW2_PERMISSION_STATE_DENY,
        COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL, COREWEBVIEW2_WEB_ERROR_STATUS,
        COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
    };
    use webview2_com::{
        AcceleratorKeyPressedEventHandler, BasicAuthenticationRequestedEventHandler,
        BytesReceivedChangedEventHandler, CallDevToolsProtocolMethodCompletedHandler,
        DownloadStartingEventHandler, FaviconChangedEventHandler, HistoryChangedEventHandler,
        NavigationCompletedEventHandler, PermissionRequestedEventHandler, ProcessFailedEventHandler,
        ServerCertificateErrorDetectedEventHandler, StateChangedEventHandler,
        TrySuspendCompletedHandler,
    };
    use windows::core::{Interface, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::RECT;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
    };

    thread_local! {
        /// Live download operations keyed by our download id, so a later
        /// `download_cancel` command can reach the right one. Only ever touched
        /// on the UI thread (where the events fire and `cancel_download` is
        /// marshaled), so a plain thread-local `RefCell` is sound — the COM
        /// interface pointers are not `Send`. Entries are removed when the
        /// download reaches a terminal state.
        static DOWNLOADS: RefCell<HashMap<String, ICoreWebView2DownloadOperation>> =
            RefCell::new(HashMap::new());

        /// Pending permission prompts (camera/mic/geo/notifications/clipboard),
        /// keyed by the id the chrome UI echoes back in `permission_respond`.
        /// Value pairs the args (to set Allow/Deny) with the deferral (to
        /// release the paused request). UI-thread only, like DOWNLOADS.
        static PERMS: RefCell<
            HashMap<String, (ICoreWebView2PermissionRequestedEventArgs, ICoreWebView2Deferral)>,
        > = RefCell::new(HashMap::new());

        /// Pending HTTP basic-auth challenges, keyed like PERMS.
        static AUTHS: RefCell<
            HashMap<
                String,
                (ICoreWebView2BasicAuthenticationRequestedEventArgs, ICoreWebView2Deferral),
            >,
        > = RefCell::new(HashMap::new());

        /// Pending TLS certificate-error interstitials, keyed like PERMS.
        static CERTS: RefCell<
            HashMap<
                String,
                (ICoreWebView2ServerCertificateErrorDetectedEventArgs, ICoreWebView2Deferral),
            >,
        > = RefCell::new(HashMap::new());
    }

    /// Monotonic source of per-download ids (`dl1`, `dl2`, …). A counter, not a
    /// clock/random, so it's deterministic and needs no extra deps.
    static NEXT_DL_ID: AtomicU64 = AtomicU64::new(1);
    /// Shared monotonic source for permission/auth/cert request ids.
    static NEXT_REQ_ID: AtomicU64 = AtomicU64::new(1);

    fn next_req_id(prefix: &str) -> String {
        format!("{prefix}{}", NEXT_REQ_ID.fetch_add(1, Ordering::Relaxed))
    }

    pub unsafe fn open_devtools(pw: &PlatformWebview) {
        if let Ok(core) = pw.controller().CoreWebView2() {
            let _ = core.OpenDevToolsWindow();
        }
    }

    /// Send `Target.getTargetInfo` to the page and forward the resulting
    /// `targetId` through `tx`. The completion handler fires asynchronously on
    /// the UI thread; if the call can't even be issued we send an empty string
    /// so the waiting caller doesn't block for the full timeout.
    pub unsafe fn resolve_target_id(pw: &PlatformWebview, tx: std::sync::mpsc::Sender<String>) {
        let Ok(core) = pw.controller().CoreWebView2() else {
            let _ = tx.send(String::new());
            return;
        };
        let method = HSTRING::from("Target.getTargetInfo");
        let params = HSTRING::from("{}");
        let handler =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, result| {
                // The macro hands the PCWSTR result back already decoded to a
                // String; it's the CDP reply JSON on success.
                let json = if hr.is_ok() { result } else { String::new() };
                let id = serde_json::from_str::<serde_json::Value>(&json)
                    .ok()
                    .and_then(|v| {
                        v.get("targetInfo")?
                            .get("targetId")?
                            .as_str()
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_default();
                let _ = tx.send(id);
                Ok(())
            }));
        if core
            .CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()), &handler)
            .is_err()
        {
            // The handler won't fire; the Sender it owns drops here, so the
            // caller's recv returns Err (disconnected) rather than hanging.
        }
    }

    pub fn cancel_download(id: &str) {
        DOWNLOADS.with(|m| {
            if let Some(op) = m.borrow().get(id) {
                unsafe {
                    let _ = op.Cancel();
                }
            }
        });
    }

    /// Read a WebView2 `PWSTR`-out getter into an owned `String`, freeing the
    /// COM-allocated buffer. Empty string on failure/null.
    unsafe fn read_pwstr(
        get: impl FnOnce(&mut PWSTR) -> windows::core::Result<()>,
    ) -> String {
        let mut ptr = PWSTR::null();
        if get(&mut ptr).is_ok() && !ptr.is_null() {
            let s = ptr.to_string().unwrap_or_default();
            CoTaskMemFree(Some(ptr.0 as *const _));
            s
        } else {
            String::new()
        }
    }

    // Zoom steps, matching Chrome's ladder loosely; clamped to a sane range.
    const ZOOM_MIN: f64 = 0.25;
    const ZOOM_MAX: f64 = 5.0;
    const ZOOM_STEP: f64 = 1.1;

    /// True while the given virtual key is physically down (high bit of the
    /// per-key state). Read live inside the key event, so it reflects the
    /// modifiers held for *this* keystroke.
    unsafe fn down(vk: u16) -> bool {
        (GetKeyState(vk as i32) as u16 & 0x8000) != 0
    }

    /// Nudge the controller bounds 1px and back, synchronously on the UI
    /// thread, to force WebView2's first paint of a fresh child webview. Two
    /// distinct SetBounds calls: the intermediate (1px shorter) rect makes the
    /// engine register a genuine size change and paint, then we restore the
    /// real rect. Neither can be coalesced away (unlike a Tauri set_size pair).
    unsafe fn nudge_bounds(controller: &ICoreWebView2Controller) {
        let mut bounds = RECT::default();
        if controller.Bounds(&mut bounds).is_err() {
            return;
        }
        let mut nudged = bounds;
        nudged.bottom -= 1;
        let _ = controller.SetBounds(nudged);
        let _ = controller.SetBounds(bounds);
    }

    pub unsafe fn force_repaint(pw: &PlatformWebview) {
        nudge_bounds(&pw.controller());
    }

    pub unsafe fn suspend(pw: &PlatformWebview) {
        if let Ok(core) = pw.controller().CoreWebView2() {
            if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
                // Requires the controller be hidden (callers hide first). The
                // completed handler's result is best-effort; ignore it.
                let handler = TrySuspendCompletedHandler::create(Box::new(|_hr, _ok| Ok(())));
                let _ = core3.TrySuspend(&handler);
            }
        }
    }

    pub unsafe fn resume(pw: &PlatformWebview) {
        if let Ok(core) = pw.controller().CoreWebView2() {
            if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
                let _ = core3.Resume();
            }
        }
    }

    pub unsafe fn install(app: &AppHandle, id: &str, pw: &PlatformWebview) {
        let controller = pw.controller();
        install_accelerators(app, id, &controller);
        if let Ok(core) = controller.CoreWebView2() {
            install_process_failed(app, id, &core);
            install_favicon(app, id, &core);
            install_downloads(app, id, &core);
            install_permissions(app, id, &core);
            install_basic_auth(app, id, &core);
            install_navigation_completed(app, id, &core);
            install_history(app, id, &core);
            install_cert_error(app, id, &core);
        }
    }

    /// The web-platform permission kinds we surface a Chrome-style prompt for.
    /// Kinds we don't recognise are left to WebView2's default handling.
    fn perm_kind_str(kind: COREWEBVIEW2_PERMISSION_KIND) -> Option<&'static str> {
        Some(match kind {
            COREWEBVIEW2_PERMISSION_KIND_CAMERA => "camera",
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => "microphone",
            COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION => "geolocation",
            COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => "notifications",
            COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => "clipboard",
            _ => return None,
        })
    }

    /// Prompt for camera/mic/geolocation/notifications/clipboard, the way Chrome
    /// does, instead of WebView2's silent default-deny. The request is paused
    /// with a deferral and stashed in PERMS; the chrome UI shows a prompt and
    /// calls back `permission_respond`, which sets Allow/Deny and resumes it.
    /// A decision WebView2 already persisted for this origin (State != Default)
    /// is honoured silently — that's our "remember" behaviour, for free.
    unsafe fn install_permissions(app: &AppHandle, id: &str, core: &ICoreWebView2) {
        let app = app.clone();
        let tab_id = id.to_string();
        let handler = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND(0);
            let _ = args.PermissionKind(&mut kind);
            let Some(kind_str) = perm_kind_str(kind) else {
                return Ok(()); // leave unknown kinds to the engine default
            };
            // Honour a remembered decision without re-prompting.
            let mut state = COREWEBVIEW2_PERMISSION_STATE_DEFAULT;
            let _ = args.State(&mut state);
            if state != COREWEBVIEW2_PERMISSION_STATE_DEFAULT {
                return Ok(());
            }
            let origin = read_pwstr(|p| args.Uri(p));
            let Ok(deferral) = args.GetDeferral() else {
                return Ok(());
            };
            let req_id = next_req_id("perm");
            PERMS.with(|m| m.borrow_mut().insert(req_id.clone(), (args.clone(), deferral)));
            let value = serde_json::json!({
                "id": req_id, "kind": kind_str, "origin": origin,
            })
            .to_string();
            crate::tabs::emit_tab_event(&app, &tab_id, "permission", value);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_PermissionRequested(&handler, &mut token);
    }

    /// Answer a permission prompt. Runs on the UI thread (marshaled by the
    /// command) since the args/deferral have thread affinity.
    pub fn permission_respond(id: &str, allow: bool) {
        PERMS.with(|m| {
            if let Some((args, deferral)) = m.borrow_mut().remove(id) {
                unsafe {
                    let state = if allow {
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW
                    } else {
                        COREWEBVIEW2_PERMISSION_STATE_DENY
                    };
                    let _ = args.SetState(state);
                    let _ = deferral.Complete();
                }
            }
        });
    }

    /// Surface a Chrome-style username/password dialog for HTTP basic auth
    /// (401 Basic), which WebView2 otherwise answers with nothing. Paused with a
    /// deferral; the chrome UI collects credentials and calls `basic_auth_respond`.
    unsafe fn install_basic_auth(app: &AppHandle, id: &str, core: &ICoreWebView2) {
        let Ok(core10) = core.cast::<ICoreWebView2_10>() else {
            return;
        };
        let app = app.clone();
        let tab_id = id.to_string();
        let handler =
            BasicAuthenticationRequestedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()) };
                let uri = read_pwstr(|p| args.Uri(p));
                let challenge = read_pwstr(|p| args.Challenge(p));
                let Ok(deferral) = args.GetDeferral() else {
                    return Ok(());
                };
                let req_id = next_req_id("auth");
                AUTHS.with(|m| m.borrow_mut().insert(req_id.clone(), (args.clone(), deferral)));
                let value = serde_json::json!({
                    "id": req_id, "origin": uri, "challenge": challenge,
                })
                .to_string();
                crate::tabs::emit_tab_event(&app, &tab_id, "basic-auth", value);
                Ok(())
            }));
        let mut token = 0i64;
        let _ = core10.add_BasicAuthenticationRequested(&handler, &mut token);
    }

    /// Answer a basic-auth prompt: supply credentials, or cancel if the user
    /// dismissed it. UI thread only.
    pub fn basic_auth_respond(id: &str, username: Option<String>, password: Option<String>) {
        AUTHS.with(|m| {
            if let Some((args, deferral)) = m.borrow_mut().remove(id) {
                unsafe {
                    match (username, password) {
                        (Some(u), Some(p)) => {
                            if let Ok(resp) = args.Response() {
                                let uw: Vec<u16> = u.encode_utf16().chain([0]).collect();
                                let pw: Vec<u16> = p.encode_utf16().chain([0]).collect();
                                let _ = resp.SetUserName(PWSTR(uw.as_ptr() as *mut u16));
                                let _ = resp.SetPassword(PWSTR(pw.as_ptr() as *mut u16));
                            }
                        }
                        _ => {
                            let _ = args.SetCancel(true);
                        }
                    }
                    let _ = deferral.Complete();
                }
            }
        });
    }

    /// Report a failed main-frame navigation (DNS failure, connection refused,
    /// TLS block, timeout…) so the chrome UI can draw a branded error page with
    /// a Reload button, instead of leaving Chromium's raw interstitial showing.
    unsafe fn install_navigation_completed(app: &AppHandle, id: &str, core: &ICoreWebView2) {
        let app = app.clone();
        let tab_id = id.to_string();
        let core_for_source = core.clone();
        let handler = NavigationCompletedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut ok = windows::core::BOOL(1);
            let _ = args.IsSuccess(&mut ok);
            if ok.as_bool() {
                return Ok(());
            }
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS(0);
            let _ = args.WebErrorStatus(&mut status);
            eprintln!(
                "[UWB-PROBE] nav-completed tab={} status={} source={}",
                tab_id,
                status.0,
                read_pwstr(|p| core_for_source.Source(p))
            );
            // A navigation we deliberately cancelled (external-protocol handoff,
            // stop button) isn't an error — don't draw an error page for it.
            if status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
                return Ok(());
            }
            let url = read_pwstr(|p| core_for_source.Source(p));
            // uwb:/about: internal targets never show a network error page.
            if !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("file:") {
                return Ok(());
            }
            let value = serde_json::json!({ "url": url, "code": status.0 }).to_string();
            crate::tabs::emit_tab_event(&app, &tab_id, "nav-error", value);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_NavigationCompleted(&handler, &mut token);
    }

    /// Emit the tab's back/forward availability whenever session history
    /// changes, so the toolbar can grey the arrows out like Chrome (our
    /// buttons drive the engine's real history via eval, so JS can't track it).
    unsafe fn install_history(app: &AppHandle, id: &str, core: &ICoreWebView2) {
        let app = app.clone();
        let tab_id = id.to_string();
        let core_cb = core.clone();
        let handler = HistoryChangedEventHandler::create(Box::new(move |_sender, _args| {
            let mut back = windows::core::BOOL(0);
            let mut fwd = windows::core::BOOL(0);
            let _ = core_cb.CanGoBack(&mut back);
            let _ = core_cb.CanGoForward(&mut fwd);
            let value =
                serde_json::json!({ "back": back.as_bool(), "forward": fwd.as_bool() }).to_string();
            crate::tabs::emit_tab_event(&app, &tab_id, "nav-state", value);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_HistoryChanged(&handler, &mut token);
    }

    /// Turn a TLS certificate error into a Chrome-style interstitial the user
    /// can read and (for non-fatal errors) click through, rather than WebView2's
    /// dead-end block. Paused with a deferral; `cert_respond` sets the action.
    unsafe fn install_cert_error(app: &AppHandle, id: &str, core: &ICoreWebView2) {
        let Ok(core14) = core.cast::<ICoreWebView2_14>() else {
            return;
        };
        let app = app.clone();
        let tab_id = id.to_string();
        let handler =
            ServerCertificateErrorDetectedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()) };
                let uri = read_pwstr(|p| args.RequestUri(p));
                let mut status = COREWEBVIEW2_WEB_ERROR_STATUS(0);
                let _ = args.ErrorStatus(&mut status);
                let Ok(deferral) = args.GetDeferral() else {
                    return Ok(());
                };
                let req_id = next_req_id("cert");
                CERTS.with(|m| m.borrow_mut().insert(req_id.clone(), (args.clone(), deferral)));
                let value =
                    serde_json::json!({ "id": req_id, "url": uri, "code": status.0 }).to_string();
                crate::tabs::emit_tab_event(&app, &tab_id, "cert-error", value);
                Ok(())
            }));
        let mut token = 0i64;
        let _ = core14.add_ServerCertificateErrorDetected(&handler, &mut token);
    }

    /// Resolve a certificate interstitial: proceed (allow this cert for the
    /// session) or cancel the load. UI thread only.
    pub fn cert_respond(id: &str, proceed: bool) {
        CERTS.with(|m| {
            if let Some((args, deferral)) = m.borrow_mut().remove(id) {
                unsafe {
                    let action = if proceed {
                        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW
                    } else {
                        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL
                    };
                    let _ = args.SetAction(action);
                    let _ = deferral.Complete();
                }
            }
        });
    }

    /// Open WebView2's built-in print preview (the browser one, matching
    /// Chrome's Ctrl+P), on the tab's CoreWebView2.
    pub unsafe fn print(pw: &PlatformWebview) {
        if let Ok(core) = pw.controller().CoreWebView2() {
            if let Ok(core16) = core.cast::<ICoreWebView2_16>() {
                let _ = core16.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER);
            }
        }
    }

    /// Emit a `download` tab-event carrying the operation's full live state as
    /// JSON: our `id`, the `state` ("start" | "progress" | "done" | "fail" |
    /// "cancel"), the file `name`/`path`, the source `url`, and byte counts
    /// (`received`/`total`; total is -1 when the server sent no length). The
    /// chrome UI keys its downloads panel + top-bar progress ring off this.
    unsafe fn emit_download(
        app: &AppHandle,
        tab_id: &str,
        dl_id: &str,
        state: &str,
        op: &ICoreWebView2DownloadOperation,
    ) {
        let path = read_pwstr(|p| op.ResultFilePath(p));
        let url = read_pwstr(|p| op.Uri(p));
        let mut received = 0i64;
        let _ = op.BytesReceived(&mut received);
        let mut total = 0i64;
        let _ = op.TotalBytesToReceive(&mut total);
        let name = std::path::Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&path);
        let value = serde_json::json!({
            "id": dl_id,
            "state": state,
            "name": name,
            "path": path,
            "url": url,
            "received": received,
            "total": total,
        })
        .to_string();
        crate::tabs::emit_tab_event(app, tab_id, "download", value);
    }

    unsafe fn install_downloads(
        app: &AppHandle,
        id: &str,
        core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    ) {
        // add_DownloadStarting is on ICoreWebView2_4; skip on older runtimes.
        let Ok(core4) = core.cast::<ICoreWebView2_4>() else {
            return;
        };
        let app = app.clone();
        let tab_id = id.to_string();
        let handler = DownloadStartingEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            if let Ok(op) = args.DownloadOperation() {
                let dl_id = format!("dl{}", NEXT_DL_ID.fetch_add(1, Ordering::Relaxed));
                // Register the operation so a later cancel can reach it.
                DOWNLOADS.with(|m| m.borrow_mut().insert(dl_id.clone(), op.clone()));
                emit_download(&app, &tab_id, &dl_id, "start", &op);

                // Stream progress: BytesReceivedChanged fires as bytes land, so
                // the panel's per-item bar and the top-bar ring track live.
                let app_p = app.clone();
                let tab_p = tab_id.clone();
                let dl_p = dl_id.clone();
                let on_bytes = BytesReceivedChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(op) = sender.as_ref() {
                        emit_download(&app_p, &tab_p, &dl_p, "progress", op);
                    }
                    Ok(())
                }));
                let mut t_bytes = 0i64;
                let _ = op.add_BytesReceivedChanged(&on_bytes, &mut t_bytes);

                // Watch to a terminal state (done / fail / user-cancel).
                let app_s = app.clone();
                let tab_s = tab_id.clone();
                let dl_s = dl_id.clone();
                let on_state = StateChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(op) = sender.as_ref() {
                        report_state(&app_s, &tab_s, &dl_s, op);
                    }
                    Ok(())
                }));
                let mut t_state = 0i64;
                let _ = op.add_StateChanged(&on_state, &mut t_state);
            }
            // Suppress WebView2's own download flyout; the download still proceeds
            // to ResultFilePath and we surface it in the chrome UI instead.
            let _ = args.SetHandled(true);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core4.add_DownloadStarting(&handler, &mut token);
    }

    unsafe fn report_state(
        app: &AppHandle,
        tab_id: &str,
        dl_id: &str,
        op: &ICoreWebView2DownloadOperation,
    ) {
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED;
        let _ = op.State(&mut state);
        let terminal = if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
            "done"
        } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
            // Separate a deliberate cancel from a genuine failure so the UI can
            // label them differently.
            let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE;
            let _ = op.InterruptReason(&mut reason);
            if reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED {
                "cancel"
            } else {
                "fail"
            }
        } else {
            return; // still in progress
        };
        emit_download(app, tab_id, dl_id, terminal, op);
        // Done with this operation; drop it from the cancel registry.
        DOWNLOADS.with(|m| {
            m.borrow_mut().remove(dl_id);
        });
    }

    unsafe fn install_accelerators(app: &AppHandle, id: &str, controller: &ICoreWebView2Controller) {
        let app = app.clone();
        let id = id.to_string();
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
            let _ = args.KeyEventKind(&mut kind);
            // Only key-*down* events (plain + Alt/"system"); ignore key-up so an
            // action doesn't fire twice per chord.
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
            {
                return Ok(());
            }
            let mut vk = 0u32;
            let _ = args.VirtualKey(&mut vk);
            let ctrl = down(VK_CONTROL.0);
            let shift = down(VK_SHIFT.0);
            let alt = down(VK_MENU.0);

            // Native zoom: handle right here off the sender controller so it's
            // instant and needs no round-trip.
            if ctrl && !alt {
                if let Some(action) = zoom_action(vk) {
                    if let Some(controller) = sender.as_ref() {
                        apply_zoom(&app, &id, controller, action);
                    }
                    let _ = args.SetHandled(true);
                    return Ok(());
                }
            }

            if let Some(action) = action_for(vk, ctrl, shift, alt) {
                // Claim the chord so the focused page doesn't also act on it.
                let _ = args.SetHandled(true);
                crate::tabs::emit_tab_event(&app, &id, "shortcut", action.to_string());
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);
    }

    /// Zoom-key → step. Ctrl+= / Ctrl++ in, Ctrl+- out, Ctrl+0 reset.
    fn zoom_action(vk: u32) -> Option<&'static str> {
        match vk {
            // VK_OEM_PLUS, VK_ADD, '='
            0xBB | 0x6B => Some("in"),
            // VK_OEM_MINUS, VK_SUBTRACT
            0xBD | 0x6D => Some("out"),
            // '0', VK_NUMPAD0
            0x30 | 0x60 => Some("reset"),
            _ => None,
        }
    }

    unsafe fn apply_zoom(
        app: &AppHandle,
        id: &str,
        controller: &ICoreWebView2Controller,
        action: &str,
    ) {
        let mut current = 1.0f64;
        let _ = controller.ZoomFactor(&mut current);
        let next = match action {
            "in" => (current * ZOOM_STEP).min(ZOOM_MAX),
            "out" => (current / ZOOM_STEP).max(ZOOM_MIN),
            _ => 1.0,
        };
        let _ = controller.SetZoomFactor(next);
        // Let the chrome UI toast the level (e.g. "125%").
        let pct = (next * 100.0).round() as i64;
        crate::tabs::emit_tab_event(app, id, "zoom", pct.to_string());
    }

    /// Map a chord to an action name the chrome UI's shortcut handler knows.
    /// Mirrors the DOM keydown routing in App.tsx so both paths behave alike.
    fn action_for(vk: u32, ctrl: bool, shift: bool, alt: bool) -> Option<&'static str> {
        // Alt+Arrow: history nav (no Ctrl).
        if alt && !ctrl {
            return match vk {
                0x25 => Some("back"),    // VK_LEFT
                0x27 => Some("forward"), // VK_RIGHT
                _ => None,
            };
        }
        // F5: reload, F12: developer tools (no modifiers required).
        if vk == 0x74 && !ctrl && !alt {
            return Some("reload");
        }
        if vk == 0x7B && !ctrl && !alt {
            return Some("devtools"); // VK_F12
        }
        if !ctrl || alt {
            return None;
        }
        // Ctrl (optionally +Shift) chords.
        match vk {
            0x49 if shift => Some("devtools"),                        // Ctrl+Shift+I
            0x09 => Some(if shift { "prev-tab" } else { "next-tab" }), // Tab
            0x54 => Some(if shift { "reopen-tab" } else { "new-tab" }), // T
            0x57 => Some("close-tab"),                                  // W
            0x4C => Some("focus-omnibox"),                             // L
            0x52 => Some("reload"),                                     // R
            0x46 => Some("find"),                                       // F
            0x48 => Some("history"),                                    // H
            0x50 => Some("print"),                                      // P
            0x4A => Some("downloads"),                                  // J
            0x44 => Some("pin"),                                        // D
            0x2E | 0x08 if shift => Some("clear-data"),                 // Delete/Backspace
            0xBC => Some("settings"),                                   // VK_OEM_COMMA
            0xC0 => Some("terminal"),                                   // VK_OEM_3 (`)
            0x31 => Some("tab-1"),
            0x32 => Some("tab-2"),
            0x33 => Some("tab-3"),
            0x34 => Some("tab-4"),
            0x35 => Some("tab-5"),
            0x36 => Some("tab-6"),
            0x37 => Some("tab-7"),
            0x38 => Some("tab-8"),
            0x39 => Some("tab-9"),
            _ => None,
        }
    }

    unsafe fn install_process_failed(
        app: &AppHandle,
        id: &str,
        core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    ) {
        let app = app.clone();
        let id = id.to_string();
        let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, _args| {
            // The renderer (or a subframe) died; tell the chrome UI to draw a
            // recoverable "this page crashed" panel with a Reload button.
            crate::tabs::emit_tab_event(&app, &id, "crashed", String::new());
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_ProcessFailed(&handler, &mut token);
    }

    unsafe fn install_favicon(
        app: &AppHandle,
        id: &str,
        core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    ) {
        // FaviconChanged is on ICoreWebView2_15; older runtimes just skip it and
        // fall back to the frontend's favicon service.
        let Ok(core15) = core.cast::<ICoreWebView2_15>() else {
            return;
        };
        let app = app.clone();
        let id = id.to_string();
        let handler = FaviconChangedEventHandler::create(Box::new(move |sender, _args| {
            if let Some(sender) = sender.as_ref() {
                if let Ok(core15) = sender.cast::<ICoreWebView2_15>() {
                    let mut uri = windows::core::PWSTR::null();
                    if core15.FaviconUri(&mut uri).is_ok() && !uri.is_null() {
                        let s = uri.to_string().unwrap_or_default();
                        windows::Win32::System::Com::CoTaskMemFree(Some(
                            uri.0 as *const core::ffi::c_void,
                        ));
                        if !s.is_empty() {
                            crate::tabs::emit_tab_event(&app, &id, "favicon", s);
                        }
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core15.add_FaviconChanged(&handler, &mut token);
    }
}
