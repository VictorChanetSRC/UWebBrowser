use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::unreal::BuildRequest;

pub const SEV_WARNING: u8 = 1;
pub const SEV_ERROR: u8 = 2;

/// ASCII case-insensitive substring test that allocates nothing. `needle` must
/// be lowercase. A large UE build emits hundreds of thousands of log lines, so
/// avoiding a per-line lowercase `String` matters.
fn contains_ci(haystack: &str, needle: &[u8]) -> bool {
    let h = haystack.as_bytes();
    if needle.is_empty() {
        return true;
    }
    if h.len() < needle.len() {
        return false;
    }
    h.windows(needle.len())
        .any(|w| w.iter().zip(needle).all(|(a, b)| a.eq_ignore_ascii_case(b)))
}

/// Best-effort severity from UE/UBT/MSVC log conventions: "LogFoo: Error:",
/// "ERROR:", "error C2065", "fatal error", and the warning equivalents.
pub fn classify(line: &str) -> u8 {
    if contains_ci(line, b"error:") || contains_ci(line, b" error c") || contains_ci(line, b"fatal error")
    {
        SEV_ERROR
    } else if contains_ci(line, b"warning:") || contains_ci(line, b" warning c") {
        SEV_WARNING
    } else {
        0
    }
}

fn builds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("builds");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Writes one build's log to `<id>.jsonl` as it streams (one
/// `{t, sev, text}` object per line, t = ms since start), then a summary to
/// `<id>.json` when the job exits. Recording is best-effort: if the app data
/// dir is unavailable the build still runs, just unrecorded.
pub struct Recorder {
    dir: PathBuf,
    id: String,
    project: String,
    action: String,
    config: String,
    platform: String,
    archive_dir: Option<String>,
    log: BufWriter<File>,
    started: Instant,
    started_epoch_ms: u64,
    warnings: u32,
    errors: u32,
    stages: Vec<Value>,
}

impl Recorder {
    pub fn create(
        app: &AppHandle,
        req: &BuildRequest,
        project: &str,
        archive_dir: Option<String>,
    ) -> Option<Recorder> {
        let dir = builds_dir(app).ok()?;
        // job_id names two on-disk files (`<id>.jsonl` here, `<id>.json` in
        // `finish`). It's supplied by the caller, so reject anything that isn't
        // a plain id — a value like `..\..\evil` would otherwise create/
        // overwrite files outside the builds dir.
        if !valid_id(&req.job_id) {
            return None;
        }
        let log = File::create(dir.join(format!("{}.jsonl", req.job_id))).ok()?;
        Some(Recorder {
            dir,
            id: req.job_id.clone(),
            project: project.to_string(),
            action: req.action.clone(),
            config: req.config.clone(),
            platform: req.platform.clone(),
            archive_dir,
            log: BufWriter::new(log),
            started: Instant::now(),
            started_epoch_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            warnings: 0,
            errors: 0,
            stages: Vec::new(),
        })
    }

    pub fn line(&mut self, text: &str) {
        let sev = classify(text);
        match sev {
            SEV_ERROR => self.errors += 1,
            SEV_WARNING => self.warnings += 1,
            _ => {}
        }
        let entry = json!({
            "t": self.started.elapsed().as_millis() as u64,
            "sev": sev,
            "text": text,
        });
        let _ = writeln!(self.log, "{entry}");
    }

    pub fn stage(&mut self, name: &str) {
        self.stages.push(json!({
            "name": name,
            "atMs": self.started.elapsed().as_millis() as u64,
        }));
    }

    pub fn finish(mut self, exit_code: i32, cancelled: bool) {
        let _ = self.log.flush();
        let summary = json!({
            "cancelled": cancelled,
            "id": self.id,
            "project": self.project,
            "action": self.action,
            "config": self.config,
            "platform": self.platform,
            "archiveDir": self.archive_dir,
            "startedAt": self.started_epoch_ms,
            "durationMs": self.started.elapsed().as_millis() as u64,
            "exitCode": exit_code,
            "warnings": self.warnings,
            "errors": self.errors,
            "stages": self.stages,
        });
        let _ = fs::write(
            self.dir.join(format!("{}.json", self.id)),
            serde_json::to_vec_pretty(&summary).unwrap_or_default(),
        );
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Newest N build records kept on disk; older `.json`/`.jsonl` pairs are pruned.
const MAX_HISTORY: usize = 100;

/// Past build summaries, newest first, capped at `MAX_HISTORY`. Older records
/// are deleted from disk on the way through so the folder can't grow forever.
#[tauri::command]
pub async fn build_history(app: AppHandle) -> Result<Vec<Value>, String> {
    let dir = builds_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Value>, String> {
        let mut records = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            if path.extension().map(|ext| ext != "json").unwrap_or(true) {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            if let Ok(record) = serde_json::from_str::<Value>(&raw) {
                records.push(record);
            }
        }
        records.sort_by_key(|r| std::cmp::Reverse(r["startedAt"].as_u64().unwrap_or(0)));
        // Prune everything past the cap: delete the summary and its log.
        for stale in records.iter().skip(MAX_HISTORY) {
            if let Some(id) = stale["id"].as_str() {
                let _ = fs::remove_file(dir.join(format!("{id}.json")));
                let _ = fs::remove_file(dir.join(format!("{id}.jsonl")));
            }
        }
        records.truncate(MAX_HISTORY);
        Ok(records)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Log lines of one recorded build. `only_issues` keeps warnings and errors
/// (capped at 3000); the full log is capped to its last 2000 lines.
#[tauri::command]
pub async fn build_log(
    app: AppHandle,
    id: String,
    only_issues: bool,
) -> Result<Vec<Value>, String> {
    if !valid_id(&id) {
        return Err("invalid build id".into());
    }
    let path = builds_dir(&app)?.join(format!("{id}.jsonl"));
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Value>, String> {
        let file = File::open(&path).map_err(|_| "log not found for this build")?;
        let mut lines: VecDeque<Value> = VecDeque::new();
        for raw in BufReader::new(file).lines().map_while(Result::ok) {
            // Each entry serializes as {"sev":N,"t":..,"text":..}; only sev 1/2
            // are issues. Skip the parse for the overwhelming majority (sev 0)
            // by a cheap substring test — the escaped quotes in `text` can't
            // masquerade as the unescaped `"sev":1`/`"sev":2` field.
            if only_issues && !(raw.contains("\"sev\":1") || raw.contains("\"sev\":2")) {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            if only_issues {
                if entry["sev"].as_u64().unwrap_or(0) > 0 {
                    lines.push_back(entry);
                    if lines.len() >= 3000 {
                        break;
                    }
                }
            } else {
                lines.push_back(entry);
                if lines.len() > 2000 {
                    lines.pop_front();
                }
            }
        }
        Ok(lines.into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_build_history(app: AppHandle) -> Result<(), String> {
    let dir = builds_dir(&app)?;
    // The directory scan + up to 200 file deletions are blocking fs I/O; keep
    // them off the async worker like the sibling history commands do.
    tauri::async_runtime::spawn_blocking(move || {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|ext| ext == "json" || ext == "jsonl")
            {
                let _ = fs::remove_file(path);
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn find_exes(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 4 || out.len() > 200 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            find_exes(&path, depth + 1, out);
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        {
            out.push(path);
        }
    }
}

/// Show a folder in the system file manager.
#[tauri::command]
pub async fn reveal_in_explorer(path: String) -> Result<(), String> {
    crate::os::with_existing_path(path, crate::os::open_path).await
}

/// Launch the game from a packaged (archived) build directory: prefer
/// `<Project>.exe`, otherwise the shallowest exe that isn't engine plumbing.
#[tauri::command]
pub async fn launch_packaged(dir: String, project: String) -> Result<String, String> {
    // The recursive exe walk (up to 200 files, depth 4) plus the process spawn
    // are blocking; keep them off the async worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&dir);
        if !root.is_dir() {
            return Err(format!("{dir} doesn't exist — was the build moved or deleted?"));
        }
        const SKIP: [&str; 4] = [
            "crashreportclient",
            "unrealpak",
            "epicwebhelper",
            "unrealcefsubprocess",
        ];
        let mut exes = Vec::new();
        find_exes(&root, 0, &mut exes);
        exes.retain(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| !SKIP.contains(&s.to_ascii_lowercase().as_str()))
        });
        let target = project.to_ascii_lowercase();
        exes.sort_by_key(|p| {
            let stem = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            (u32::from(stem != target), p.components().count())
        });
        let exe = exes
            .first()
            .ok_or("No .exe found in the packaged output.")?;
        let mut cmd = Command::new(exe);
        cmd.current_dir(exe.parent().unwrap_or(&root));
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(exe.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
