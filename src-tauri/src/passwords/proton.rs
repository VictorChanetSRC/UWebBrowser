//! Proton Pass backend, driven through the official `pass-cli`.
//!
//! We shell out rather than touch Proton's private HTTP API. Proton
//! end-to-end-encrypts item contents, so URLs and usernames aren't in a plain
//! `item list` — we enumerate vaults (`vault list`), then read each vault with
//! `item list --share-id … --show-secrets` to get URLs/usernames for matching,
//! and `item view` for the password at fill time. `login
//! --personal-access-token` signs in from inside the app; the CLI keeps its own
//! encrypted session in the OS keyring and we never persist Proton secrets.
//!
//! A decrypting `--show-secrets` read of a large vault isn't cheap, so listings
//! are cached in memory for a few seconds. The cache holds titles / usernames /
//! URLs for matching — never passwords, which are always fetched fresh.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::origin::{self, Origin};
use super::provider::{
    Capabilities, CredentialProvider, CredentialSecret, CredentialSummary, NewCredential, State,
    StatusReport,
};

/// `share_id:item_id`, the pair Proton needs to view an item. We pack it into
/// the summary id so `secret()` can split it back out.
fn pack_id(share: &str, item: &str) -> String {
    format!("{share}:{item}")
}

#[derive(Clone)]
struct Row {
    share_id: String,
    item_id: String,
    title: String,
    username: String,
    url: String,
}

const CACHE_TTL: Duration = Duration::from_secs(120);

pub struct ProtonProvider {
    /// Overridable for tests / non-PATH installs; defaults to `pass-cli`.
    bin: String,
    /// Short-lived listing cache (metadata only, no passwords). Interior
    /// mutability so the read-only trait methods can populate it.
    cache: Mutex<Option<(Instant, Vec<Row>)>>,
}

impl ProtonProvider {
    pub fn new() -> ProtonProvider {
        ProtonProvider {
            bin: "pass-cli".to_string(),
            cache: Mutex::new(None),
        }
    }

    fn invalidate(&self) {
        *self.cache.lock().expect("proton cache mutex poisoned") = None;
    }

    fn run(&self, args: &[&str]) -> Result<String, CliError> {
        match exec(&self.bin, args) {
            // A winget-installed CLI should be on PATH, but our process captured
            // PATH at launch — and a portable install without Developer Mode
            // never gets a PATH shim at all. So if the plain name isn't found,
            // fall back to winget's install location. This makes a
            // just-installed CLI usable without restarting the app.
            Err(CliError::NotInstalled) => match winget_bin() {
                Some(path) => exec(&path.to_string_lossy(), args),
                None => Err(CliError::NotInstalled),
            },
            other => other,
        }
    }

    fn logged_in(&self) -> Result<bool, CliError> {
        // `info` exits non-zero (or reports no session) when logged out.
        match self.run(&["info", "--output", "json"]) {
            Ok(out) => Ok(!out.trim().is_empty() && !out.contains("not logged in")),
            Err(CliError::NotInstalled) => Err(CliError::NotInstalled),
            Err(_) => Ok(false),
        }
    }

    fn vault_shares(&self) -> Result<Vec<String>, String> {
        let out = self
            .run(&["vault", "list", "--output", "json"])
            .map_err(|e| e.message())?;
        let value: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
        Ok(value
            .get("vaults")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.get("share_id").and_then(|s| s.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default())
    }

    fn load_rows(&self) -> Result<Vec<Row>, String> {
        if let Some((at, rows)) = self.cache.lock().expect("proton cache mutex poisoned").as_ref() {
            if at.elapsed() < CACHE_TTL {
                return Ok(rows.clone());
            }
        }
        let mut rows = Vec::new();
        for share in self.vault_shares()? {
            // A failed vault (e.g. permissions) shouldn't sink the whole list.
            if let Ok(out) = self.run(&[
                "item",
                "list",
                "--share-id",
                &share,
                "--show-secrets",
                "--output",
                "json",
            ]) {
                parse_rows_into(&out, &mut rows);
            }
        }
        *self.cache.lock().expect("proton cache mutex poisoned") = Some((Instant::now(), rows.clone()));
        Ok(rows)
    }
}

impl CredentialProvider for ProtonProvider {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            id: "proton".to_string(),
            label: "Proton Pass".to_string(),
            blurb: "End-to-end encrypted and synced across your devices through the Proton Pass CLI.".to_string(),
            can_save: true,
            can_generate: true,
            syncs: true,
            needs_master_password: false,
            unlock_secret: "token".to_string(),
        }
    }

    fn status(&self) -> StatusReport {
        match self.logged_in() {
            Err(CliError::NotInstalled) => StatusReport::new(
                State::Unavailable,
                "Proton Pass CLI not found. Install pass-cli, or switch to the on-device vault.",
            ),
            Ok(true) => StatusReport::new(State::Unlocked, "Signed in to Proton Pass."),
            Ok(false) | Err(_) => StatusReport::new(
                State::Locked,
                "Sign in with a Proton Pass access token, or run pass-cli login.",
            ),
        }
    }

    fn unlock(&mut self, secret: Option<&str>) -> Result<(), String> {
        if let Some(token) = secret.filter(|t| !t.is_empty()) {
            // `--flag=value` form binds the value to the flag, so a token (or,
            // in `save`, a page-captured field) that begins with `-` can't be
            // parsed as a separate CLI argument.
            let arg = format!("--personal-access-token={token}");
            self.run(&["login", &arg]).map_err(|e| e.message())?;
        } else if !self.logged_in().map_err(|e| e.message())? {
            return Err("no Proton Pass session — paste an access token or run pass-cli login".to_string());
        }
        self.invalidate();
        Ok(())
    }

    fn lock(&mut self) {
        // We don't own the Proton session (the CLI keyring does), and there's
        // no local key material to wipe. Signing out happens via pass-cli.
    }

    fn list_all(&self) -> Result<Vec<CredentialSummary>, String> {
        let mut items: Vec<CredentialSummary> = self
            .load_rows()?
            .iter()
            .map(row_summary)
            .collect();
        items.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(items)
    }

    fn list_for_origin(&self, origin: &Origin) -> Result<Vec<CredentialSummary>, String> {
        Ok(self
            .load_rows()?
            .iter()
            .filter(|row| {
                origin::host_of(&row.url)
                    .map(|h| origin::host_matches(&origin.host, &h))
                    .unwrap_or(false)
            })
            .map(row_summary)
            .collect())
    }

    fn secret(&self, id: &str) -> Result<CredentialSecret, String> {
        let (share, item) = id.split_once(':').ok_or_else(|| "bad item id".to_string())?;
        let out = self
            .run(&[
                "item", "view", "--share-id", share, "--item-id", item, "--output", "json",
            ])
            .map_err(|e| e.message())?;
        let value: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
        // item view nests as: item.content.content.Login.{ email, username,
        // password, totp_uri }.
        let login = value
            .get("item")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.get("content"))
            .and_then(|v| v.get("Login"))
            .ok_or_else(|| "item has no login content".to_string())?;
        Ok(CredentialSecret {
            username: login_identity(login),
            password: str_at(login, "password").unwrap_or_default(),
            totp: str_at(login, "totp_uri").filter(|s| !s.is_empty()),
        })
    }

    fn save(&mut self, item: NewCredential) -> Result<CredentialSummary, String> {
        // `--flag=value` form so a captured title/username/url starting with `-`
        // is bound as a value, never parsed as an argument.
        let title = format!("--title={}", item.title);
        let username = format!("--username={}", item.username);
        let password = format!("--password={}", item.password);
        let url = format!("--url={}", item.url);
        self.run(&["item", "create", "login", &title, &username, &password, &url])
            .map_err(|e| e.message())?;
        self.invalidate();
        Ok(CredentialSummary {
            id: String::new(),
            title: item.title,
            username: item.username,
            host: origin::host_of(&item.url).unwrap_or_default(),
        })
    }
}

fn row_summary(row: &Row) -> CredentialSummary {
    CredentialSummary {
        id: pack_id(&row.share_id, &row.item_id),
        title: row.title.clone(),
        username: row.username.clone(),
        host: origin::host_of(&row.url).unwrap_or_default(),
    }
}

/// Parse `item list --show-secrets --output json` into login rows. Each item
/// nests as `{ id, share_id, content: { title, content: { Login: { email,
/// username, urls } } } }`; non-login items (notes, aliases, cards) have no
/// `Login` key and are skipped.
fn parse_rows_into(out: &str, rows: &mut Vec<Row>) {
    let value: Value = match serde_json::from_str(out) {
        Ok(v) => v,
        Err(_) => return,
    };
    let Some(items) = value.get("items").and_then(|v| v.as_array()) else {
        return;
    };
    for entry in items {
        let Some(item_id) = entry.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let share_id = entry.get("share_id").and_then(|v| v.as_str()).unwrap_or("");
        let content = entry.get("content");
        let Some(login) = content
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("Login"))
        else {
            continue;
        };
        rows.push(Row {
            share_id: share_id.to_string(),
            item_id: item_id.to_string(),
            title: content
                .and_then(|c| c.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            username: login_identity(login),
            url: first_url(login),
        });
    }
}

/// The username to show/fill: Proton's `username` field, falling back to
/// `email` (login items often set only one).
fn login_identity(login: &Value) -> String {
    let username = str_at(login, "username").unwrap_or_default();
    if !username.is_empty() {
        username
    } else {
        str_at(login, "email").unwrap_or_default()
    }
}

/// First URL from a login's `urls` array.
fn first_url(login: &Value) -> String {
    login
        .get("urls")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find_map(|v| v.as_str()))
        .unwrap_or("")
        .to_string()
}

fn str_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

/// Run a `pass-cli` invocation and capture stdout. A missing binary maps to
/// `NotInstalled` so callers can offer to install it.
fn exec(bin: &str, args: &[&str]) -> Result<String, CliError> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    no_window(&mut cmd);
    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            CliError::NotInstalled
        } else {
            CliError::Io(e.to_string())
        }
    })?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(CliError::Command(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

/// Locate a winget-installed `pass-cli.exe` when it isn't on PATH. Checks the
/// Links shim first (present when winget could create it), then the portable
/// install under `Packages\Proton.ProtonPass.CLI*\`.
#[cfg(windows)]
fn winget_bin() -> Option<PathBuf> {
    let winget = PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
        .join("Microsoft")
        .join("WinGet");

    let link = winget.join("Links").join("pass-cli.exe");
    if link.exists() {
        return Some(link);
    }

    let packages = winget.join("Packages");
    for entry in std::fs::read_dir(&packages).ok()?.flatten() {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("Proton.ProtonPass.CLI")
        {
            continue;
        }
        let direct = entry.path().join("pass-cli.exe");
        if direct.exists() {
            return Some(direct);
        }
        // Some packages nest the binary one directory deeper.
        if let Ok(inner) = std::fs::read_dir(entry.path()) {
            for sub in inner.flatten() {
                let deep = sub.path().join("pass-cli.exe");
                if deep.exists() {
                    return Some(deep);
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn winget_bin() -> Option<PathBuf> {
    None
}

/// Install the Proton Pass CLI through winget (the official Windows package).
/// Runs on a blocking thread — don't call it on the async runtime directly.
pub fn install_pass_cli() -> Result<(), String> {
    let mut cmd = Command::new("winget");
    cmd.args([
        "install",
        "-e",
        "--id",
        "Proton.ProtonPass.CLI",
        "--silent",
        "--accept-source-agreements",
        "--accept-package-agreements",
    ]);
    no_window(&mut cmd);
    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "winget isn't available on this PC. Install the Proton Pass CLI from proton.me, or use the on-device vault.".to_string()
        } else {
            format!("couldn't start winget: {e}")
        }
    })?;
    if output.status.success() {
        return Ok(());
    }
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    // winget reports an already-present package as a non-zero "no applicable
    // upgrade" — that's success for our purposes.
    if combined.to_lowercase().contains("already installed") {
        return Ok(());
    }
    let code = output.status.code().unwrap_or(-1);
    Err(format!("winget couldn't install pass-cli (code {code}). {}", combined.trim()))
}

enum CliError {
    NotInstalled,
    Io(String),
    Command(String),
}

impl CliError {
    fn message(&self) -> String {
        match self {
            CliError::NotInstalled => "Proton Pass CLI (pass-cli) is not installed".to_string(),
            CliError::Io(e) => format!("pass-cli failed to run: {e}"),
            CliError::Command(e) if e.is_empty() => "pass-cli returned an error".to_string(),
            CliError::Command(e) => e.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mirrors the real `item list --show-secrets --output json` shape.
    const LIST: &str = r#"{
      "items": [
        {
          "id": "ITEM1", "share_id": "SHARE1", "item_type": "login",
          "content": {
            "title": "Clerk",
            "content": { "Login": {
              "email": "me@proton.me", "username": "",
              "password": "secret", "urls": ["https://dashboard.clerk.com/"]
            } }
          }
        },
        {
          "id": "NOTE1", "share_id": "SHARE1",
          "content": { "title": "A note", "content": { "Note": {} } }
        }
      ]
    }"#;

    #[test]
    fn parses_login_rows_and_skips_non_logins() {
        let mut rows = Vec::new();
        parse_rows_into(LIST, &mut rows);
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.item_id, "ITEM1");
        assert_eq!(row.share_id, "SHARE1");
        assert_eq!(row.title, "Clerk");
        // username empty → falls back to email.
        assert_eq!(row.username, "me@proton.me");
        assert_eq!(row.url, "https://dashboard.clerk.com/");
    }

    #[test]
    fn row_matches_its_site() {
        let mut rows = Vec::new();
        parse_rows_into(LIST, &mut rows);
        let host = origin::host_of(&rows[0].url).unwrap();
        assert!(origin::host_matches("dashboard.clerk.com", &host));
        assert!(!origin::host_matches("evil.com", &host));
    }
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}
