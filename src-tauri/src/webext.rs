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

/// Force a first paint on a freshly-created child webview that WebView2 leaves
/// blank until its controller bounds actually change. Nudges the *native*
/// controller bounds by 1px and back, synchronously on the UI thread — going
/// through Tauri's `set_size` instead coalesces the two calls into no net
/// change, so WebView2 skips the resize and never repaints (this is why the
/// extension popup stayed white in release). No-op off Windows.
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

#[cfg(windows)]
mod imp {
    use super::*;
    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventArgs, ICoreWebView2Controller,
        ICoreWebView2DownloadOperation, ICoreWebView2_15, ICoreWebView2_3, ICoreWebView2_4,
        COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED, COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
    };
    use webview2_com::{
        AcceleratorKeyPressedEventHandler, DownloadStartingEventHandler,
        FaviconChangedEventHandler, ProcessFailedEventHandler, StateChangedEventHandler,
        TrySuspendCompletedHandler,
    };
    use windows::core::Interface;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
    };

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

    pub unsafe fn force_repaint(pw: &PlatformWebview) {
        let controller = pw.controller();
        let mut bounds = RECT::default();
        if controller.Bounds(&mut bounds).is_err() {
            return;
        }
        // Two distinct, synchronous SetBounds calls: the intermediate (1px
        // shorter) rect makes WebView2 register a genuine size change and
        // paint, then we restore the real rect. Both run on the UI thread
        // inside this callback, so neither can be coalesced away.
        let mut nudged = bounds;
        nudged.bottom -= 1;
        let _ = controller.SetBounds(nudged);
        let _ = controller.SetBounds(bounds);
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
        }
    }

    /// A `download` tab-event. `state` is "start" | "done" | "fail"; `name` is
    /// the file's basename and `path` its on-disk location, JSON-encoded into the
    /// event value so the chrome UI can toast progress and offer "show in folder".
    fn emit_download(app: &AppHandle, id: &str, state: &str, path: &str) {
        let name = std::path::Path::new(path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(path);
        let value = serde_json::json!({ "state": state, "name": name, "path": path }).to_string();
        crate::tabs::emit_tab_event(app, id, "download", value);
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
        let id = id.to_string();
        let handler = DownloadStartingEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            if let Ok(op) = args.DownloadOperation() {
                let mut path = windows::core::PWSTR::null();
                let start_path = if op.ResultFilePath(&mut path).is_ok() && !path.is_null() {
                    let s = path.to_string().unwrap_or_default();
                    windows::Win32::System::Com::CoTaskMemFree(Some(path.0 as *const _));
                    s
                } else {
                    String::new()
                };
                emit_download(&app, &id, "start", &start_path);
                // Watch the operation to a terminal state for the completion toast.
                let app2 = app.clone();
                let id2 = id.clone();
                let on_state = StateChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(op) = sender.as_ref() {
                        report_state(&app2, &id2, op);
                    }
                    Ok(())
                }));
                let mut token = 0i64;
                let _ = op.add_StateChanged(&on_state, &mut token);
            }
            // Suppress WebView2's own download flyout; the download still proceeds
            // to ResultFilePath and we surface it in the chrome UI instead.
            let _ = args.SetHandled(true);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core4.add_DownloadStarting(&handler, &mut token);
    }

    unsafe fn report_state(app: &AppHandle, id: &str, op: &ICoreWebView2DownloadOperation) {
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED;
        let _ = op.State(&mut state);
        let terminal = if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
            "done"
        } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
            "fail"
        } else {
            return; // still in progress
        };
        let mut path = windows::core::PWSTR::null();
        let p = if op.ResultFilePath(&mut path).is_ok() && !path.is_null() {
            let s = path.to_string().unwrap_or_default();
            windows::Win32::System::Com::CoTaskMemFree(Some(path.0 as *const _));
            s
        } else {
            String::new()
        };
        emit_download(app, id, terminal, &p);
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
        // F5: reload (no modifiers required).
        if vk == 0x74 && !ctrl && !alt {
            return Some("reload");
        }
        if !ctrl || alt {
            return None;
        }
        // Ctrl (optionally +Shift) chords.
        match vk {
            0x09 => Some(if shift { "prev-tab" } else { "next-tab" }), // Tab
            0x54 => Some(if shift { "reopen-tab" } else { "new-tab" }), // T
            0x57 => Some("close-tab"),                                  // W
            0x4C => Some("focus-omnibox"),                             // L
            0x52 => Some("reload"),                                     // R
            0x46 => Some("find"),                                       // F
            0x48 => Some("history"),                                    // H
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
