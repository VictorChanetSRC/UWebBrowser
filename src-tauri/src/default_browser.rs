//! Chrome-style default-browser plumbing.
//!
//! Windows decides what appears in Settings → Default apps purely from the
//! registry: an app is "a browser" once it's listed under RegisteredApplications
//! with http/https capabilities. Like Chrome we rewrite our registration under
//! HKCU on every launch — self-healing when an update or a move changes the exe
//! path, and needing no admin rights. We never touch the user's actual choice:
//! since Windows 10 the UserChoice key is hash-protected, so becoming default is
//! always a trip to Windows Settings, which `open_default_browser_settings`
//! deep-links to. The NSIS uninstall hook (windows/hooks.nsi) removes these keys.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// http/https URLs handed to us by the OS on launch, waiting for the chrome UI
/// to come up and collect them.
#[derive(Default)]
pub struct StartupUrls(Mutex<Vec<String>>);

impl StartupUrls {
    pub fn from_env() -> Self {
        let cwd = std::env::current_dir().ok();
        Self(Mutex::new(
            std::env::args()
                .skip(1)
                .filter_map(|a| launch_url(&a, cwd.as_deref()))
                .collect(),
        ))
    }
}

/// A command-line argument the OS handed us, resolved to something a tab can
/// load: web and file URLs pass through, and an existing local file (a
/// double-clicked .html, delivered as a plain path) becomes a file:// URL.
/// Flags and junk resolve to None. Note `Url::parse` happily parses `C:\…` as
/// scheme "c", so paths fall through to the filesystem check.
fn launch_url(arg: &str, cwd: Option<&std::path::Path>) -> Option<String> {
    if let Ok(u) = url::Url::parse(arg) {
        if matches!(u.scheme(), "http" | "https" | "file") {
            return Some(u.into());
        }
    }
    let path = std::path::Path::new(arg);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd?.join(path)
    };
    if path.is_file() {
        return url::Url::from_file_path(&path).ok().map(Into::into);
    }
    None
}

/// Drained once by the chrome UI when it mounts; anything the OS sends after
/// that arrives as an `open-url` event through the single-instance callback.
#[tauri::command]
pub fn take_startup_urls(state: tauri::State<'_, StartupUrls>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap_or_else(|e| e.into_inner()))
}

/// A second launch (the user opened a link or file somewhere while we're
/// running): surface the existing window and forward the URLs to the chrome UI.
pub fn on_second_instance(app: &AppHandle, argv: &[String], cwd: &str) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let cwd = std::path::Path::new(cwd);
    for url in argv.iter().skip(1).filter_map(|a| launch_url(a, Some(cwd))) {
        let _ = app.emit_to(crate::tabs::CHROME_LABEL, "open-url", url);
    }
}

/// Best-effort: a failed registration must never block startup.
pub fn register_as_browser() {
    if let Err(e) = win::register() {
        eprintln!("default-browser registration failed: {e}");
    }
}

#[tauri::command]
pub fn is_default_browser() -> bool {
    win::is_default()
}

#[tauri::command]
pub fn open_default_browser_settings() -> Result<(), String> {
    win::open_settings().map_err(|e| e.to_string())
}

#[cfg(windows)]
mod win {
    use winreg::enums::{RegType, HKEY_CURRENT_USER};
    use winreg::{RegKey, RegValue};

    /// The class Windows resolves http/https to once we're the default.
    const PROG_ID: &str = "UWebBrowserHTML";
    /// Also the value name under RegisteredApplications, which is what the
    /// ms-settings `registeredAppUser` deep-link matches on.
    const APP_NAME: &str = "UWebBrowser";
    const CLIENT_KEY: &str = "Software\\Clients\\StartMenuInternet\\UWebBrowser";
    /// Local document types we can render (WebView2 handles all of these,
    /// including its built-in PDF viewer). Mirrored in windows/hooks.nsi.
    const FILE_EXTENSIONS: [&str; 7] =
        [".htm", ".html", ".shtml", ".svg", ".xht", ".xhtml", ".pdf"];

    /// Write a value only when it differs, so the common every-launch case is a
    /// read-only no-op and we can skip the shell-refresh broadcast.
    fn set(key: &RegKey, name: &str, value: &str) -> std::io::Result<bool> {
        if key.get_value::<String, _>(name).ok().as_deref() == Some(value) {
            return Ok(false);
        }
        key.set_value(name, &value)?;
        Ok(true)
    }

    pub fn register() -> std::io::Result<()> {
        let exe = std::env::current_exe()?;
        let exe = exe.to_string_lossy();
        let icon = format!("\"{exe}\",0");
        let open_url = format!("\"{exe}\" \"%1\"");
        let open_plain = format!("\"{exe}\"");

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let mut changed = false;

        // The ProgID: how Windows opens a link with us.
        let (class, _) = hkcu.create_subkey(format!("Software\\Classes\\{PROG_ID}"))?;
        changed |= set(&class, "", "UWebBrowser HTML Document")?;
        let (k, _) = class.create_subkey("DefaultIcon")?;
        changed |= set(&k, "", &icon)?;
        let (k, _) = class.create_subkey("shell\\open\\command")?;
        changed |= set(&k, "", &open_url)?;

        // Right-click → "Open with" lists us for local documents even while
        // another browser is the default. The value must merely exist; its
        // conventional type is REG_NONE with no data.
        for ext in FILE_EXTENSIONS {
            let (k, _) =
                hkcu.create_subkey(format!("Software\\Classes\\{ext}\\OpenWithProgids"))?;
            if k.get_raw_value(PROG_ID).is_err() {
                k.set_raw_value(
                    PROG_ID,
                    &RegValue {
                        bytes: vec![],
                        vtype: RegType::REG_NONE,
                    },
                )?;
                changed = true;
            }
        }

        // The browser client and its capabilities: what makes Settings →
        // Default apps list us as a browser.
        let (client, _) = hkcu.create_subkey(CLIENT_KEY)?;
        changed |= set(&client, "", APP_NAME)?;
        let (k, _) = client.create_subkey("DefaultIcon")?;
        changed |= set(&k, "", &icon)?;
        let (k, _) = client.create_subkey("shell\\open\\command")?;
        changed |= set(&k, "", &open_plain)?;
        let (caps, _) = client.create_subkey("Capabilities")?;
        changed |= set(&caps, "ApplicationName", APP_NAME)?;
        changed |= set(&caps, "ApplicationIcon", &icon)?;
        changed |= set(
            &caps,
            "ApplicationDescription",
            "The web browser for Unreal Engine developers.",
        )?;
        let (k, _) = caps.create_subkey("StartMenu")?;
        changed |= set(&k, "StartMenuInternet", APP_NAME)?;
        let (assoc, _) = caps.create_subkey("URLAssociations")?;
        changed |= set(&assoc, "http", PROG_ID)?;
        changed |= set(&assoc, "https", PROG_ID)?;
        let (files, _) = caps.create_subkey("FileAssociations")?;
        for ext in FILE_EXTENSIONS {
            changed |= set(&files, ext, PROG_ID)?;
        }

        let (registered, _) = hkcu.create_subkey("Software\\RegisteredApplications")?;
        changed |= set(&registered, APP_NAME, &format!("{CLIENT_KEY}\\Capabilities"))?;

        if changed {
            refresh_shell();
        }
        Ok(())
    }

    pub fn is_default() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        ["http", "https"].iter().all(|scheme| {
            hkcu.open_subkey(format!(
                "Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\{scheme}\\UserChoice"
            ))
            .and_then(|k| k.get_value::<String, _>("ProgId"))
            .map(|id| id == PROG_ID)
            .unwrap_or(false)
        })
    }

    /// Tell the shell associations changed so Default apps picks us up without
    /// a logoff/logon.
    fn refresh_shell() {
        #[link(name = "shell32")]
        extern "system" {
            fn SHChangeNotify(
                event_id: i32,
                flags: u32,
                item1: *const std::ffi::c_void,
                item2: *const std::ffi::c_void,
            );
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        const SHCNF_IDLIST: u32 = 0;
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
    }

    pub fn open_settings() -> std::io::Result<()> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // Windows 11 deep-links straight to our row in Default apps; Windows 10
        // ignores the query and lands on the Default apps page.
        std::process::Command::new("cmd")
            .args([
                "/C",
                "start",
                "",
                "ms-settings:defaultapps?registeredAppUser=UWebBrowser",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::launch_url;

    #[test]
    fn web_urls_pass_through_and_junk_is_dropped() {
        assert_eq!(
            launch_url("https://example.com/a?b=1", None).as_deref(),
            Some("https://example.com/a?b=1")
        );
        assert!(launch_url("--flag", None).is_none());
        assert!(launch_url("C:\\does\\not\\exist.html", None).is_none());
    }

    #[test]
    fn existing_files_become_file_urls() {
        let dir = std::env::temp_dir().join("uwb-launch-url-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("page with space.html");
        std::fs::write(&file, "<html></html>").unwrap();

        let url = launch_url(file.to_str().unwrap(), None).unwrap();
        assert!(url.starts_with("file:///"));
        assert!(url.ends_with("page%20with%20space.html"));
        // Relative paths resolve against the launching process's cwd.
        assert_eq!(launch_url("page with space.html", Some(&dir)).unwrap(), url);

        std::fs::remove_dir_all(&dir).ok();
    }
}

/// Non-Windows: nothing to register, and reporting "already default" keeps the
/// prompt from ever showing.
#[cfg(not(windows))]
mod win {
    pub fn register() -> std::io::Result<()> {
        Ok(())
    }
    pub fn is_default() -> bool {
        true
    }
    pub fn open_settings() -> std::io::Result<()> {
        Ok(())
    }
}
