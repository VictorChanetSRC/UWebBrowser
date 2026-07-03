//! Interactive terminal tabs: one ConPTY-backed shell per terminal tab.
//!
//! The chrome webview renders xterm.js; this module owns the native side —
//! spawning the shell under a PTY, pumping its output to the frontend as
//! `term-output` events and announcing death via `term-exit`.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::tabs::CHROME_LABEL;

/// Distinguishes a session from its replacement after a restart, so the
/// waiter thread of a killed shell never removes (or announces the death of)
/// the fresh session that reused the same tab id.
static NEXT_GEN: AtomicU64 = AtomicU64::new(0);

struct Session {
    gen: u64,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct TermState {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TermOutput {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TermExit {
    id: String,
    code: Option<u32>,
}

/// Command Prompt on Windows; $SHELL on unix.
fn default_shell() -> String {
    #[cfg(windows)]
    {
        // %ComSpec% is the canonical path to cmd.exe.
        std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

#[tauri::command]
pub async fn term_create(
    app: AppHandle,
    state: tauri::State<'_, TermState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // A restart reuses the tab id; make sure the old shell is gone first.
    if let Some(mut old) = state.sessions.lock().unwrap().remove(&id) {
        let _ = old.killer.kill();
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = app.path().home_dir() {
        cmd.cwd(home);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let gen = NEXT_GEN.fetch_add(1, Ordering::Relaxed);
    state.sessions.lock().unwrap().insert(
        id.clone(),
        Session {
            gen,
            writer,
            master: pair.master,
            killer,
        },
    );

    // Reader: PTY output -> chrome webview. A carry buffer keeps multi-byte
    // UTF-8 sequences split across reads intact.
    let app_out = app.clone();
    let id_out = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            pending.extend_from_slice(&buf[..n]);
            let keep = match std::str::from_utf8(&pending) {
                Ok(_) => 0,
                // A clean cut through the last character: hold the tail back.
                Err(e) if e.error_len().is_none() && pending.len() - e.valid_up_to() < 4 => {
                    pending.len() - e.valid_up_to()
                }
                // Genuinely invalid bytes: let lossy replacement handle them.
                Err(_) => 0,
            };
            let text = String::from_utf8_lossy(&pending[..pending.len() - keep]).into_owned();
            pending.drain(..pending.len() - keep);
            if !text.is_empty() {
                let _ = app_out.emit_to(
                    CHROME_LABEL,
                    "term-output",
                    TermOutput {
                        id: id_out.clone(),
                        data: text,
                    },
                );
            }
        }
    });

    // Waiter: owns the child, reaps the exit code. Only speaks up if this
    // session is still the current one for the id (not killed by a replace
    // in term_create or a term_close, both of which remove it first).
    let app_exit = app.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code());
        let state = app_exit.state::<TermState>();
        let mut sessions = state.sessions.lock().unwrap();
        if sessions.get(&id).map(|s| s.gen) == Some(gen) {
            sessions.remove(&id);
            drop(sessions);
            let _ = app_exit.emit_to(CHROME_LABEL, "term-exit", TermExit { id, code });
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn term_write(
    state: tauri::State<'_, TermState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("no terminal session")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_resize(
    state: tauri::State<'_, TermState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("no terminal session")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_close(state: tauri::State<'_, TermState>, id: String) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        let _ = session.killer.kill();
    }
    Ok(())
}
