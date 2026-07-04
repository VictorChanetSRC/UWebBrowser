//! The backend-agnostic contract every credential source implements.
//!
//! `LocalVault` and the Proton Pass CLI are the first two providers; anything
//! that can list logins for a site and hand back a secret on request can slot
//! in behind this trait (Bitwarden `bw`, 1Password `op`, …).

use serde::{Deserialize, Serialize};

use super::origin::Origin;

/// What a backend can do. The UI reads this to adapt — hide the generator where
/// there is none, show a "syncs across devices" note where it applies, ask for
/// a master password only where one is needed.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub id: String,
    pub label: String,
    pub blurb: String,
    pub can_save: bool,
    pub can_generate: bool,
    /// Whether items can be edited in place from the panel. Proton items are
    /// managed through the Proton apps, so the CLI backend says no.
    pub can_edit: bool,
    pub can_delete: bool,
    pub syncs: bool,
    /// Local vault unlocks with a master password; Proton unlocks with a CLI
    /// session (or a pasted access token).
    pub needs_master_password: bool,
    /// The secret asked for on unlock: "password" or "token" (drives the
    /// unlock field's label and type), or empty when none is needed.
    pub unlock_secret: String,
}

/// The lifecycle state the UI renders around. Serializes to the same snake_case
/// strings the frontend matches on (`"unavailable"`, `"needs_setup"`, …).
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// Backend can't run here (Proton CLI not installed).
    Unavailable,
    /// Local vault has never been created — collect a new master password.
    NeedsSetup,
    /// Ready but sealed — collect the unlock secret.
    Locked,
    /// Open for reads.
    Unlocked,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub state: State,
    /// A short, human line for the current state ("Proton Pass CLI not found").
    pub detail: String,
}

impl StatusReport {
    pub fn new(state: State, detail: impl Into<String>) -> StatusReport {
        StatusReport {
            state,
            detail: detail.into(),
        }
    }
}

/// A non-secret list row. Never carries a password.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSummary {
    pub id: String,
    pub title: String,
    pub username: String,
    pub host: String,
    /// The stored URL, so the edit form can round-trip it unchanged.
    pub url: String,
}

/// The secret half, produced only at fill time for a single item.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSecret {
    pub username: String,
    pub password: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totp: Option<String>,
}

/// A new login to store.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCredential {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
}

pub trait CredentialProvider: Send {
    fn capabilities(&self) -> Capabilities;
    fn status(&self) -> StatusReport;

    /// Create the store for the first time (local vault only). Backends without
    /// a setup step treat this as an unlock.
    fn setup(&mut self, secret: &str) -> Result<(), String> {
        self.unlock(Some(secret))
    }

    /// Open the store. `secret` is a master password (local) or an optional
    /// access token (Proton — `None` means "use the existing CLI session").
    fn unlock(&mut self, secret: Option<&str>) -> Result<(), String>;

    /// Seal the store and wipe key material from memory.
    fn lock(&mut self);

    fn list_all(&self) -> Result<Vec<CredentialSummary>, String>;

    /// Logins whose stored host matches `origin` under the matching policy.
    fn list_for_origin(&self, origin: &Origin) -> Result<Vec<CredentialSummary>, String>;

    /// The secret for one item. Called only on an explicit, origin-checked fill.
    fn secret(&self, id: &str) -> Result<CredentialSecret, String>;

    fn save(&mut self, item: NewCredential) -> Result<CredentialSummary, String>;

    /// Rewrite an existing item. Only offered where `can_edit` is true.
    fn update(&mut self, _id: &str, _item: NewCredential) -> Result<CredentialSummary, String> {
        Err("this backend doesn't support editing from here".to_string())
    }

    /// Remove an item. Only offered where `can_delete` is true.
    fn delete(&mut self, _id: &str) -> Result<(), String> {
        Err("this backend doesn't support deleting from here".to_string())
    }
}
