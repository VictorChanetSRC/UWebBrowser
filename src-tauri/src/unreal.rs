use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::history::Recorder;

use crate::tabs::CHROME_LABEL;

/// Running build jobs, keyed by job id → process id.
/// The reader thread owns the Child and removes the entry when it exits.
#[derive(Default)]
pub struct BuildState {
    jobs: Mutex<HashMap<String, u32>>,
    /// Jobs the user asked to cancel, so history doesn't call them failures.
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInstall {
    pub id: String,
    pub version: String,
    pub path: String,
    /// "launcher" | "source" | "manual"
    pub source: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UProjectInfo {
    pub name: String,
    pub dir: String,
    pub engine_association: String,
    pub has_code: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildEvent {
    id: String,
    kind: String,
    value: String,
    /// Only present on the batched `"lines"` kind; omitted otherwise so the
    /// existing `stage`/`done`/`line` payloads stay byte-for-byte the same.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    lines: Vec<String>,
}

fn emit_build_event(app: &AppHandle, id: &str, kind: &str, value: String) {
    let _ = app.emit_to(
        CHROME_LABEL,
        "build-event",
        BuildEvent {
            id: id.to_string(),
            kind: kind.to_string(),
            value,
            lines: Vec::new(),
        },
    );
}

/// One event carrying a batch of streamed log lines, kind `"lines"`.
fn emit_build_lines(app: &AppHandle, id: &str, lines: Vec<String>) {
    if lines.is_empty() {
        return;
    }
    let _ = app.emit_to(
        CHROME_LABEL,
        "build-event",
        BuildEvent {
            id: id.to_string(),
            kind: "lines".to_string(),
            value: String::new(),
            lines,
        },
    );
}

/// Read a child stream to EOF, recording every line and forwarding them to the
/// UI in batches (~every 100ms or 64 lines, whichever comes first) to keep IPC
/// traffic sane on chatty builds. `detect_stage` is set only for stdout, where
/// UAT prints its "COMMAND STARTED" stage markers.
fn pump<R: std::io::Read>(
    reader: R,
    app: &AppHandle,
    id: &str,
    recorder: &Arc<Mutex<Option<Recorder>>>,
    detect_stage: bool,
) {
    let mut batch: Vec<String> = Vec::new();
    let mut last_flush = Instant::now();
    for line in BufReader::new(reader).lines().map_while(Result::ok) {
        let stage = if detect_stage { stage_of(&line) } else { None };
        // One lock per line (was two): record the stage marker and the line.
        if let Some(rec) = recorder.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            if let Some(stage) = stage {
                rec.stage(stage);
            }
            rec.line(&line);
        }
        if let Some(stage) = stage {
            // Flush pending lines first so the stage marker keeps its order.
            emit_build_lines(app, id, std::mem::take(&mut batch));
            emit_build_event(app, id, "stage", stage.to_string());
            last_flush = Instant::now();
        }
        batch.push(line);
        if batch.len() >= 64 || last_flush.elapsed() >= Duration::from_millis(100) {
            emit_build_lines(app, id, std::mem::take(&mut batch));
            last_flush = Instant::now();
        }
    }
    emit_build_lines(app, id, batch);
}

/// Exact version from Engine/Build/Build.version, e.g. "5.4.4".
fn build_version(engine_root: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(engine_root.join("Engine/Build/Build.version")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    Some(format!(
        "{}.{}.{}",
        json.get("MajorVersion")?.as_u64()?,
        json.get("MinorVersion")?.as_u64()?,
        json.get("PatchVersion")?.as_u64()?
    ))
}

fn is_engine_root(path: &Path) -> bool {
    path.join("Engine/Build/Build.version").is_file()
}

#[cfg(windows)]
fn launcher_installs(engines: &mut Vec<EngineInstall>) {
    let program_data =
        std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    let dat = PathBuf::from(program_data).join("Epic\\UnrealEngineLauncher\\LauncherInstalled.dat");
    let Ok(raw) = std::fs::read_to_string(dat) else {
        return;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let Some(list) = json.get("InstallationList").and_then(|v| v.as_array()) else {
        return;
    };
    for item in list {
        let app_name = item.get("AppName").and_then(|v| v.as_str()).unwrap_or("");
        if !app_name.starts_with("UE_") {
            continue;
        }
        let Some(location) = item.get("InstallLocation").and_then(|v| v.as_str()) else {
            continue;
        };
        let root = PathBuf::from(location);
        if !is_engine_root(&root) {
            continue;
        }
        let version = build_version(&root)
            .unwrap_or_else(|| app_name.trim_start_matches("UE_").to_string());
        engines.push(EngineInstall {
            id: app_name.to_string(),
            version,
            path: location.to_string(),
            source: "launcher".to_string(),
        });
    }
}

/// Source builds register themselves under HKCU as GUID → path.
#[cfg(windows)]
fn registry_builds(engines: &mut Vec<EngineInstall>) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let Ok(key) =
        RegKey::predef(HKEY_CURRENT_USER).open_subkey("SOFTWARE\\Epic Games\\Unreal Engine\\Builds")
    else {
        return;
    };
    for (guid, value) in key.enum_values().flatten() {
        let path = value.to_string();
        let root = PathBuf::from(&path);
        if !is_engine_root(&root) {
            continue;
        }
        let Some(version) = build_version(&root) else {
            continue;
        };
        engines.push(EngineInstall {
            id: guid,
            version,
            path,
            source: "source".to_string(),
        });
    }
}

#[tauri::command]
pub async fn detect_engines() -> Result<Vec<EngineInstall>, String> {
    let mut engines = Vec::new();
    #[cfg(windows)]
    {
        launcher_installs(&mut engines);
        registry_builds(&mut engines);
    }
    Ok(engines)
}

/// Validate a manually picked folder as an engine root and read its version.
#[tauri::command]
pub async fn validate_engine(path: String) -> Result<EngineInstall, String> {
    let root = PathBuf::from(&path);
    let version = build_version(&root).ok_or(
        "Not an Unreal Engine folder. Pick the root that contains Engine\\Build\\Build.version.",
    )?;
    Ok(EngineInstall {
        id: format!("manual-{version}-{path}"),
        version,
        path,
        source: "manual".to_string(),
    })
}

#[tauri::command]
pub async fn read_uproject(path: String) -> Result<UProjectInfo, String> {
    let file = PathBuf::from(&path);
    let raw = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let name = file
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("invalid project path")?
        .to_string();
    let dir = file
        .parent()
        .and_then(|p| p.to_str())
        .ok_or("invalid project path")?
        .to_string();
    let has_code = json
        .get("Modules")
        .and_then(|m| m.as_array())
        .map(|m| !m.is_empty())
        .unwrap_or(false)
        || PathBuf::from(&dir).join("Source").is_dir();
    Ok(UProjectInfo {
        name,
        dir,
        engine_association: json
            .get("EngineAssociation")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        has_code,
    })
}

/// Open a .uproject in the Unreal editor: the matched engine's editor binary
/// when we know it, otherwise whatever the OS associates with .uproject files
/// (the Epic version selector on Windows).
#[tauri::command]
pub async fn open_uproject(engine_path: Option<String>, uproject: String) -> Result<(), String> {
    if !PathBuf::from(&uproject).is_file() {
        return Err(format!("{uproject} doesn't exist — was it moved or deleted?"));
    }
    let engine = engine_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    if let Some(engine) = engine {
        let binaries = PathBuf::from(engine).join("Engine/Binaries");
        #[cfg(windows)]
        let candidates = ["Win64/UnrealEditor.exe", "Win64/UE4Editor.exe"];
        #[cfg(target_os = "macos")]
        let candidates = [
            "Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor",
            "Mac/UE4Editor.app/Contents/MacOS/UE4Editor",
        ];
        #[cfg(all(not(windows), not(target_os = "macos")))]
        let candidates = ["Linux/UnrealEditor", "Linux/UE4Editor"];
        for rel in candidates {
            let exe = binaries.join(rel);
            if exe.is_file() {
                Command::new(&exe)
                    .arg(&uproject)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }
    #[cfg(windows)]
    let mut cmd = Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(&uproject).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub job_id: String,
    pub engine_path: String,
    pub uproject: String,
    /// "build" | "cook" | "package"
    pub action: String,
    /// "Development" | "DebugGame" | "Shipping"
    pub config: String,
    /// "Win64" | "Linux" | "Android"
    pub platform: String,
    /// Where packaged builds land; empty/absent means <project>/Packaged/<platform>.
    #[serde(default)]
    pub archive_dir: Option<String>,
}

/// `config`/`platform` are interpolated into a `.bat` invocation, which runs
/// through `cmd.exe`. A value carrying shell metacharacters is a
/// command-injection vector (BatBadBut / CVE-2024-24576), so we require the
/// simple alphanumeric identifiers Unreal actually uses and reject anything
/// else before it reaches the command line. (`action` is already matched
/// against a fixed set below; the paths are validated by the toolchain via the
/// `is_file` checks.)
fn valid_build_token(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric())
}

fn build_command(req: &BuildRequest) -> Result<(PathBuf, Vec<String>, Option<String>), String> {
    if !valid_build_token(&req.config) {
        return Err(format!("invalid build configuration: {}", req.config));
    }
    if !valid_build_token(&req.platform) {
        return Err(format!("invalid target platform: {}", req.platform));
    }
    let engine = PathBuf::from(&req.engine_path);
    let batch = engine.join("Engine/Build/BatchFiles");
    let uproject = PathBuf::from(&req.uproject);
    let project_name = uproject
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("invalid .uproject path")?;
    let project_dir = uproject.parent().ok_or("invalid .uproject path")?;

    match req.action.as_str() {
        "build" => {
            let bat = batch.join("Build.bat");
            if !bat.is_file() {
                return Err(format!("{} not found", bat.display()));
            }
            Ok((
                bat,
                vec![
                    format!("{project_name}Editor"),
                    "Win64".to_string(),
                    req.config.clone(),
                    format!("-Project={}", uproject.display()),
                    "-WaitMutex".to_string(),
                ],
                None,
            ))
        }
        "cook" | "package" => {
            let bat = batch.join("RunUAT.bat");
            if !bat.is_file() {
                return Err(format!("{} not found", bat.display()));
            }
            let mut args = vec![
                "BuildCookRun".to_string(),
                format!("-project={}", uproject.display()),
                "-noP4".to_string(),
                "-utf8output".to_string(),
                format!("-platform={}", req.platform),
                format!("-clientconfig={}", req.config),
                "-cook".to_string(),
            ];
            let mut archive = None;
            if req.action == "package" {
                let out = req
                    .archive_dir
                    .as_deref()
                    .map(str::trim)
                    .filter(|dir| !dir.is_empty())
                    .map(PathBuf::from)
                    .unwrap_or_else(|| project_dir.join("Packaged").join(&req.platform));
                args.extend([
                    "-build".to_string(),
                    "-stage".to_string(),
                    "-pak".to_string(),
                    "-archive".to_string(),
                    format!("-archivedirectory={}", out.display()),
                ]);
                archive = Some(out.display().to_string());
            }
            Ok((bat, args, archive))
        }
        other => Err(format!("unknown action: {other}")),
    }
}

/// Which pipeline stage a UAT log line announces, if any.
fn stage_of(line: &str) -> Option<&'static str> {
    if !line.contains("COMMAND STARTED") {
        return None;
    }
    for stage in ["BUILD", "COOK", "STAGE", "PACKAGE", "ARCHIVE"] {
        if line.contains(&format!("{stage} COMMAND STARTED")) {
            return Some(match stage {
                "BUILD" => "Build",
                "COOK" => "Cook",
                "STAGE" => "Stage",
                "PACKAGE" => "Package",
                _ => "Archive",
            });
        }
    }
    None
}

#[tauri::command]
pub async fn start_build(
    app: AppHandle,
    state: tauri::State<'_, BuildState>,
    req: BuildRequest,
) -> Result<(), String> {
    let (program, args, archive) = build_command(&req)?;

    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .current_dir(program.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("failed to start: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let job_id = req.job_id.clone();
    state.jobs.lock().unwrap_or_else(|e| e.into_inner()).insert(job_id.clone(), child.id());

    // Record the run to disk (history, ETA learning); best-effort.
    let project_name = PathBuf::from(&req.uproject)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Project")
        .to_string();
    let recorder = Arc::new(Mutex::new(Recorder::create(
        &app,
        &req,
        &project_name,
        archive.clone(),
    )));

    emit_build_event(&app, &job_id, "stage", "Starting".to_string());
    emit_build_event(
        &app,
        &job_id,
        "line",
        format!("> {} {}", program.display(), args.join(" ")),
    );
    if let Some(dir) = archive {
        emit_build_event(&app, &job_id, "line", format!("> Archive directory: {dir}"));
    }

    let app_err = app.clone();
    let id_err = job_id.clone();
    let recorder_err = recorder.clone();
    std::thread::spawn(move || {
        pump(stderr, &app_err, &id_err, &recorder_err, false);
    });

    std::thread::spawn(move || {
        pump(stdout, &app, &job_id, &recorder, true);
        let code = child
            .wait()
            .ok()
            .and_then(|status| status.code())
            .unwrap_or(-1);
        let state = app.state::<BuildState>();
        state.jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&job_id);
        let cancelled = state.cancelled.lock().unwrap_or_else(|e| e.into_inner()).remove(&job_id);
        // Summary written before "done" so a refresh triggered by it sees the record.
        if let Some(rec) = recorder.lock().unwrap_or_else(|e| e.into_inner()).take() {
            rec.finish(code, cancelled);
        }
        emit_build_event(&app, &job_id, "done", code.to_string());
    });

    Ok(())
}

/// Kill the whole process tree — UAT fans out into UBT, the cooker, etc.
#[tauri::command]
pub async fn cancel_build(
    state: tauri::State<'_, BuildState>,
    job_id: String,
) -> Result<(), String> {
    let pid = state
        .jobs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&job_id)
        .copied()
        .ok_or("job not running")?;
    state.cancelled.lock().unwrap_or_else(|e| e.into_inner()).insert(job_id.clone());
    // taskkill /T /F blocks until the whole process tree is gone; keep it off
    // the async worker so other commands aren't stalled meanwhile.
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        #[cfg(windows)]
        {
            let mut cmd = Command::new("taskkill");
            cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
            cmd.status().map_err(|e| e.to_string())?;
        }
        #[cfg(not(windows))]
        {
            Command::new("kill")
                .args(["-9", &pid.to_string()])
                .status()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
