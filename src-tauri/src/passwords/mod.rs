//! Native password manager.
//!
//! The design keeps secrets on the Rust side and treats the web page as
//! untrusted:
//!
//! * Tab webviews hold no Tauri capability, so a page can't call any app
//!   command. The only page->native channel is the isolated `uwbpass` URI
//!   scheme registered here, which exposes *only* match-count / inline-fill /
//!   capture — never the general command bus.
//! * Fills are gated in [`pass_fill`]: the item must match the tab's *real*
//!   origin (read from the webview, not claimed by the page) and the origin
//!   must be fillable (https, or localhost). Only then is a secret produced and
//!   written straight into the page's fields via `eval`.
//! * The chrome UI drives everything else over normal IPC.

mod crypto;
mod inject;
mod local;
mod origin;
mod proton;
mod provider;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroize;

use local::LocalVault;
use origin::Origin;
use proton::ProtonProvider;
use provider::{
    Capabilities, CredentialProvider, CredentialSummary, NewCredential, StatusReport,
};

pub use inject::content_script;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ProviderKind {
    Local,
    Proton,
}

impl ProviderKind {
    fn from_id(id: &str) -> ProviderKind {
        match id {
            "local" => ProviderKind::Local,
            _ => ProviderKind::Proton,
        }
    }
}

pub struct PasswordManager {
    local: LocalVault,
    proton: ProtonProvider,
    active: ProviderKind,
    /// Submitted logins awaiting a "save to vault?" decision, keyed by tab
    /// webview label. Holds the password on the native side so it never has to
    /// round-trip through the chrome UI.
    pending: HashMap<String, NewCredential>,
}

impl PasswordManager {
    fn new(local_vault_path: std::path::PathBuf) -> PasswordManager {
        PasswordManager {
            local: LocalVault::new(local_vault_path),
            proton: ProtonProvider::new(),
            // Proton is the default; the user can switch to the on-device vault.
            active: ProviderKind::Proton,
            pending: HashMap::new(),
        }
    }

    fn active_ref(&self) -> &dyn CredentialProvider {
        match self.active {
            ProviderKind::Local => &self.local,
            ProviderKind::Proton => &self.proton,
        }
    }

    fn active_mut(&mut self) -> &mut dyn CredentialProvider {
        match self.active {
            ProviderKind::Local => &mut self.local,
            ProviderKind::Proton => &mut self.proton,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReport {
    id: String,
    capabilities: Capabilities,
    status: StatusReport,
}

impl ProviderReport {
    /// Snapshot a provider's id, capabilities and live status in one place, so
    /// `capabilities()` (which allocates) is called once per report.
    fn of(provider: &dyn CredentialProvider) -> ProviderReport {
        let capabilities = provider.capabilities();
        ProviderReport {
            id: capabilities.id.clone(),
            capabilities,
            status: provider.status(),
        }
    }
}

fn manager<'a>(state: &'a State<'_, Mutex<PasswordManager>>) -> std::sync::MutexGuard<'a, PasswordManager> {
    state.lock().expect("password manager mutex poisoned")
}

// --- commands ---------------------------------------------------------------

/// The active provider plus its capabilities and current state.
#[tauri::command]
pub async fn pass_status(state: State<'_, Mutex<PasswordManager>>) -> Result<ProviderReport, String> {
    let mgr = manager(&state);
    Ok(ProviderReport::of(mgr.active_ref()))
}

/// All providers with live status — used by the settings backend picker.
#[tauri::command]
pub async fn pass_providers(
    state: State<'_, Mutex<PasswordManager>>,
) -> Result<Vec<ProviderReport>, String> {
    let mgr = manager(&state);
    Ok([&mgr.proton as &dyn CredentialProvider, &mgr.local]
        .into_iter()
        .map(ProviderReport::of)
        .collect())
}

#[tauri::command]
pub async fn pass_select_provider(
    app: AppHandle,
    state: State<'_, Mutex<PasswordManager>>,
    id: String,
) -> Result<ProviderReport, String> {
    let report = {
        let mut mgr = manager(&state);
        mgr.active = ProviderKind::from_id(&id);
        ProviderReport::of(mgr.active_ref())
    };
    reprime_all(&app);
    Ok(report)
}

#[tauri::command]
pub async fn pass_setup(
    app: AppHandle,
    state: State<'_, Mutex<PasswordManager>>,
    mut secret: String,
) -> Result<(), String> {
    let result = manager(&state).active_mut().setup(&secret);
    secret.zeroize();
    result?;
    reprime_all(&app);
    Ok(())
}

/// Install the Proton Pass CLI via winget, then report the refreshed status.
/// The download runs on a blocking thread so it doesn't stall the UI's other
/// calls.
#[tauri::command]
pub async fn pass_install_cli(
    state: State<'_, Mutex<PasswordManager>>,
) -> Result<ProviderReport, String> {
    tauri::async_runtime::spawn_blocking(proton::install_pass_cli)
        .await
        .map_err(|e| e.to_string())??;
    let mgr = manager(&state);
    Ok(ProviderReport::of(mgr.active_ref()))
}

#[tauri::command]
pub async fn pass_unlock(
    app: AppHandle,
    state: State<'_, Mutex<PasswordManager>>,
    mut secret: Option<String>,
) -> Result<(), String> {
    let result = manager(&state).active_mut().unlock(secret.as_deref());
    if let Some(s) = secret.as_mut() {
        s.zeroize();
    }
    result?;
    reprime_all(&app);
    Ok(())
}

#[tauri::command]
pub async fn pass_lock(
    app: AppHandle,
    state: State<'_, Mutex<PasswordManager>>,
) -> Result<(), String> {
    manager(&state).active_mut().lock();
    reprime_all(&app);
    Ok(())
}

#[tauri::command]
pub async fn pass_list(
    state: State<'_, Mutex<PasswordManager>>,
) -> Result<Vec<CredentialSummary>, String> {
    manager(&state).active_ref().list_all()
}

/// Logins matching a page URL. Origin is parsed here; the frontend passes the
/// active tab's URL.
#[tauri::command]
pub async fn pass_matches(
    state: State<'_, Mutex<PasswordManager>>,
    url: String,
) -> Result<Vec<CredentialSummary>, String> {
    let origin = match Origin::from_url(&url) {
        Some(o) => o,
        None => return Ok(Vec::new()),
    };
    manager(&state).active_ref().list_for_origin(&origin)
}

#[tauri::command]
pub async fn pass_save(
    app: AppHandle,
    state: State<'_, Mutex<PasswordManager>>,
    item: NewCredential,
) -> Result<CredentialSummary, String> {
    let summary = manager(&state).active_mut().save(item)?;
    reprime_all(&app);
    Ok(summary)
}

/// Fill a chosen item into a tab. The security gate lives here: the item must
/// match the tab's real origin, and that origin must be fillable.
#[tauri::command]
pub async fn pass_fill(
    app: AppHandle,
    state: State<'_, Mutex<PasswordManager>>,
    tab_id: String,
    item_id: String,
) -> Result<(), String> {
    let label = crate::tabs::tab_label(&tab_id);
    let webview = app.get_webview(&label).ok_or("tab not found")?;
    let url = webview.url().map_err(|e| e.to_string())?;
    let origin = Origin::from_url(url.as_str()).ok_or("page has no origin")?;
    if !origin.is_fillable() {
        return Err("won't autofill on an insecure page".to_string());
    }

    let secret = {
        let mgr = manager(&state);
        let provider = mgr.active_ref();
        // Re-verify the item belongs to this origin — never trust the caller's
        // pairing of tab and item.
        let matches = provider.list_for_origin(&origin)?;
        if !matches.iter().any(|m| m.id == item_id) {
            return Err("that item isn't for this site".to_string());
        }
        provider.secret(&item_id)?
    };

    let js = inject::fill_script(&secret.username, &secret.password);
    webview.eval(&js).map_err(|e| e.to_string())
}

/// Save a login the user submitted on a page (captured over the bridge). The
/// password stays on the native side — chrome only ever sends the tab id.
#[tauri::command]
pub async fn pass_commit_capture(
    state: State<'_, Mutex<PasswordManager>>,
    tab_id: String,
) -> Result<CredentialSummary, String> {
    let label = crate::tabs::tab_label(&tab_id);
    let item = {
        let mut mgr = manager(&state);
        mgr.pending.remove(&label).ok_or("nothing to save")?
    };
    manager(&state).active_mut().save(item)
}

#[tauri::command]
pub async fn pass_dismiss_capture(
    state: State<'_, Mutex<PasswordManager>>,
    tab_id: String,
) -> Result<(), String> {
    manager(&state).pending.remove(&crate::tabs::tab_label(&tab_id));
    Ok(())
}

/// Push the *accounts* (id + title + username, never passwords) matching a
/// tab's current page into that tab, so the content script can offer an inline
/// account picker with no page->native call (which strict CSP would block).
/// Runs the vault work on a blocking thread; the eval lands a moment after the
/// page loads. Only accounts matching the page's own origin are pushed, and the
/// password stays native until the user explicitly picks one (see the `pick`
/// bridge op). Because only summaries are read, this never decrypts a vault
/// item or invokes the Proton CLI on page load.
pub fn prime_tab(app: &AppHandle, tab_id: &str, url: &str) {
    let app = app.clone();
    let label = crate::tabs::tab_label(tab_id);
    let origin = Origin::from_url(url).filter(|o| o.is_fillable());
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let creds = origin
            .and_then(|o| collect_for_origin(&app, &o))
            .unwrap_or_default();
        let js = format!(
            "try{{window.__uwbPass&&window.__uwbPass._set({})}}catch(e){{}}",
            serde_json::Value::Array(creds)
        );
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.eval(&js);
        }
    });
}

/// Re-push matches into every open web tab. Called after the vault state
/// changes (unlock, lock, backend switch) so already-loaded pages update
/// without a reload.
fn reprime_all(app: &AppHandle) {
    for (label, webview) in app.webviews() {
        if let Some(id) = crate::tabs::tab_id_of(&label) {
            if let Ok(url) = webview.url() {
                prime_tab(app, id, url.as_str());
            }
        }
    }
}

/// Account summaries (no passwords) for the page's origin, ready to push into
/// the content script. Reads only [`CredentialSummary`]s, so no secret is
/// decrypted here.
fn collect_for_origin(app: &AppHandle, origin: &Origin) -> Option<Vec<serde_json::Value>> {
    let state = app.state::<Mutex<PasswordManager>>();
    let mgr = state.lock().ok()?;
    let matches = mgr.active_ref().list_for_origin(origin).ok()?;
    let out = matches
        .iter()
        .take(12)
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "title": m.title,
                "username": m.username,
            })
        })
        .collect();
    Some(out)
}

/// Fill a page-picked account natively. Reached only from the `pick` bridge op,
/// which carries an item id the user chose in the inline dropdown. The secret is
/// produced here — never handed to the page — and only after re-verifying the
/// item belongs to the calling tab's real, fillable origin.
fn fill_into_tab(app: &AppHandle, label: &str, origin: &Origin, item_id: &str) -> bool {
    let secret = {
        let state = app.state::<Mutex<PasswordManager>>();
        let Ok(mgr) = state.lock() else { return false };
        let provider = mgr.active_ref();
        // Never trust the page's pairing of tab and item.
        match provider.list_for_origin(origin) {
            Ok(matches) if matches.iter().any(|m| m.id == item_id) => {}
            _ => return false,
        }
        match provider.secret(item_id) {
            Ok(s) => s,
            Err(_) => return false,
        }
    };
    match app.get_webview(label) {
        Some(webview) => webview
            .eval(&inject::fill_script(&secret.username, &secret.password))
            .is_ok(),
        None => false,
    }
}

#[tauri::command]
pub async fn pass_generate(
    length: usize,
    uppercase: bool,
    lowercase: bool,
    digits: bool,
    symbols: bool,
) -> Result<String, String> {
    generate_password(length, uppercase, lowercase, digits, symbols)
}

// --- password generator -----------------------------------------------------

/// Cryptographically-random password with at least one character from every
/// enabled class. Uses rejection sampling to avoid modulo bias.
fn generate_password(
    length: usize,
    uppercase: bool,
    lowercase: bool,
    digits: bool,
    symbols: bool,
) -> Result<String, String> {
    let mut classes: Vec<&[u8]> = Vec::new();
    if uppercase {
        classes.push(b"ABCDEFGHJKLMNPQRSTUVWXYZ");
    }
    if lowercase {
        classes.push(b"abcdefghijkmnpqrstuvwxyz");
    }
    if digits {
        classes.push(b"23456789");
    }
    if symbols {
        classes.push(b"!@#$%^&*()-_=+[]{}");
    }
    if classes.is_empty() {
        return Err("pick at least one character type".to_string());
    }
    let length = length.clamp(classes.len().max(8), 128);

    let pool: Vec<u8> = classes.iter().flat_map(|c| c.iter().copied()).collect();
    let mut out: Vec<u8> = Vec::with_capacity(length);
    // Guarantee coverage: one from each class first.
    for class in &classes {
        out.push(class[pick(class.len())?]);
    }
    while out.len() < length {
        out.push(pool[pick(pool.len())?]);
    }
    // Shuffle so the guaranteed characters aren't front-loaded.
    for i in (1..out.len()).rev() {
        out.swap(i, pick(i + 1)?);
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// Uniform random index in `0..n` via rejection sampling on a random byte.
fn pick(n: usize) -> Result<usize, String> {
    debug_assert!(n > 0 && n <= 256);
    let bound = (256 / n) * n;
    loop {
        let byte = crypto::random_bytes(1)?[0] as usize;
        if byte < bound {
            return Ok(byte % n);
        }
    }
}

// --- setup ------------------------------------------------------------------

/// Create the manager and register the isolated page->native bridge. Call from
/// the Tauri builder before `.setup()`.
pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_uri_scheme_protocol("uwbpass", bridge)
}

/// Build and manage the password manager. Call inside `.setup()` where app dirs
/// resolve.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("passwords");
    app.manage(Mutex::new(PasswordManager::new(dir.join("local-vault.json"))));
    Ok(())
}

// --- bridge -----------------------------------------------------------------

use tauri::http::{Request, Response};
use tauri::UriSchemeContext;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BridgeEvent {
    kind: String,
    tab_id: String,
    host: String,
    username: String,
}

/// The only thing a web page can reach on the native side. Every request's
/// origin is taken from the calling webview, never from the page's claim.
fn bridge(ctx: UriSchemeContext<'_, tauri::Wry>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == tauri::http::Method::OPTIONS {
        return cors(Response::builder().status(204)).body(Vec::new()).unwrap();
    }

    let app = ctx.app_handle().clone();
    let label = ctx.webview_label().to_string();
    let body = serde_json::from_slice::<serde_json::Value>(request.body()).unwrap_or_default();
    let op = body.get("op").and_then(|v| v.as_str()).unwrap_or("");

    let response = handle_bridge(&app, &label, op, &body);
    let json = serde_json::to_vec(&response).unwrap_or_else(|_| b"{}".to_vec());
    cors(Response::builder().status(200)).body(json).unwrap()
}

fn handle_bridge(
    app: &AppHandle,
    label: &str,
    op: &str,
    body: &serde_json::Value,
) -> serde_json::Value {
    // The page's real origin, from the webview we were called by.
    let origin = app
        .get_webview(label)
        .and_then(|w| w.url().ok())
        .and_then(|u| Origin::from_url(u.as_str()));
    let tab_id = crate::tabs::tab_id_of(label).unwrap_or(label).to_string();

    match op {
        // How many saved logins match this page — drives the inline badge.
        "match" => {
            let count = origin
                .as_ref()
                .filter(|o| o.is_fillable())
                .and_then(|o| {
                    let state = app.state::<Mutex<PasswordManager>>();
                    let mgr = state.lock().ok()?;
                    mgr.active_ref().list_for_origin(o).ok()
                })
                .map(|m| m.len())
                .unwrap_or(0);
            serde_json::json!({ "count": count })
        }
        // User clicked the inline badge — ask chrome to open the vault panel.
        "fill" => {
            let host = origin.as_ref().map(|o| o.host.clone()).unwrap_or_default();
            emit(app, "fill", &tab_id, &host, "");
            serde_json::json!({ "ok": true })
        }
        // User picked an account in the inline dropdown — fill it natively. The
        // password is looked up and written here; it never enters the page.
        "pick" => {
            let id = body.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let ok = origin
                .as_ref()
                .filter(|o| o.is_fillable())
                .map(|o| fill_into_tab(app, label, o, id))
                .unwrap_or(false);
            serde_json::json!({ "ok": ok })
        }
        // A submitted login — stash it natively and prompt to save.
        "capture" => {
            if let Some(o) = origin.filter(|o| o.is_fillable()) {
                let username = body.get("username").and_then(|v| v.as_str()).unwrap_or("");
                let password = body.get("password").and_then(|v| v.as_str()).unwrap_or("");
                if !password.is_empty() {
                    let item = NewCredential {
                        title: o.host.clone(),
                        username: username.to_string(),
                        password: password.to_string(),
                        url: format!("{}://{}", o.scheme, o.host),
                    };
                    if let Ok(mut mgr) = app.state::<Mutex<PasswordManager>>().lock() {
                        mgr.pending.insert(label.to_string(), item);
                    }
                    emit(app, "capture", &tab_id, &o.host, username);
                }
            }
            serde_json::json!({ "ok": true })
        }
        _ => serde_json::json!({ "error": "unknown op" }),
    }
}

fn emit(app: &AppHandle, kind: &str, tab_id: &str, host: &str, username: &str) {
    let _ = app.emit_to(
        crate::tabs::CHROME_LABEL,
        "pass-bridge",
        BridgeEvent {
            kind: kind.to_string(),
            tab_id: tab_id.to_string(),
            host: host.to_string(),
            username: username.to_string(),
        },
    );
}

fn cors(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type")
        .header("Content-Type", "application/json")
}
