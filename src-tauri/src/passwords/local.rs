//! The built-in vault. Logins live in one Argon2id + XChaCha20-Poly1305 sealed
//! file under the app data dir — never in localStorage, never in the browsing
//! profile. Unlocking derives the key from the master password and holds it in
//! memory (wiped on lock); nothing decrypted is ever written back to disk.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use super::crypto::{self, Envelope, Key};
use super::origin::{self, Origin};
use super::provider::{
    Capabilities, CredentialProvider, CredentialSecret, CredentialSummary, NewCredential, State,
    StatusReport,
};

#[derive(Clone, Serialize, Deserialize)]
struct StoredItem {
    id: String,
    title: String,
    username: String,
    password: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    totp: Option<String>,
    #[serde(default)]
    updated: u64,
}

/// Wipe the decrypted password from memory when a cached item is dropped
/// (on lock, on overwrite, or when the vault cache is cleared).
impl Drop for StoredItem {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Vault {
    #[serde(default)]
    items: Vec<StoredItem>,
}

pub struct LocalVault {
    path: PathBuf,
    /// Present only while unlocked.
    key: Option<Key>,
    /// Decrypted cache, present only while unlocked.
    vault: Option<Vault>,
    /// Salt reused across saves so the master password stays valid.
    salt: Option<Vec<u8>>,
}

impl LocalVault {
    pub fn new(path: PathBuf) -> LocalVault {
        LocalVault {
            path,
            key: None,
            vault: None,
            salt: None,
        }
    }

    fn exists(&self) -> bool {
        self.path.exists()
    }

    fn read_envelope(&self) -> Result<Envelope, String> {
        let raw = fs::read_to_string(&self.path).map_err(|e| format!("cannot read vault: {e}"))?;
        serde_json::from_str(&raw).map_err(|e| format!("corrupt vault: {e}"))
    }

    fn write(&self) -> Result<(), String> {
        let (key, salt, vault) = match (&self.key, &self.salt, &self.vault) {
            (Some(k), Some(s), Some(v)) => (k, s, v),
            _ => return Err("vault is locked".to_string()),
        };
        let plaintext = serde_json::to_vec(vault).map_err(|e| e.to_string())?;
        let envelope = crypto::seal(key, salt, &plaintext)?;
        let json = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("cannot create vault dir: {e}"))?;
        }
        fs::write(&self.path, json).map_err(|e| format!("cannot write vault: {e}"))?;
        // Owner-only on Unix; on Windows the app-data dir already inherits the
        // user profile's ACL.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    fn vault_ref(&self) -> Result<&Vault, String> {
        self.vault.as_ref().ok_or_else(|| "vault is locked".to_string())
    }

    fn summarize(item: &StoredItem) -> CredentialSummary {
        CredentialSummary {
            id: item.id.clone(),
            title: item.title.clone(),
            username: item.username.clone(),
            host: origin::host_of(&item.url).unwrap_or_default(),
            url: item.url.clone(),
        }
    }
}

impl CredentialProvider for LocalVault {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            id: "local".to_string(),
            label: "On this device".to_string(),
            blurb: "Encrypted with your master password and kept on this machine. No account, no sync.".to_string(),
            can_save: true,
            can_generate: true,
            can_edit: true,
            can_delete: true,
            syncs: false,
            needs_master_password: true,
            unlock_secret: "password".to_string(),
        }
    }

    fn status(&self) -> StatusReport {
        if !self.exists() {
            StatusReport::new(State::NeedsSetup, "Set a master password to start your vault.")
        } else if self.key.is_none() {
            StatusReport::new(State::Locked, "Enter your master password to unlock.")
        } else {
            let count = self.vault.as_ref().map(|v| v.items.len()).unwrap_or(0);
            StatusReport::new(State::Unlocked, format!("{count} saved"))
        }
    }

    fn setup(&mut self, secret: &str) -> Result<(), String> {
        if self.exists() {
            return Err("a vault already exists on this device".to_string());
        }
        if secret.chars().count() < 8 {
            return Err("use at least 8 characters".to_string());
        }
        let salt = crypto::new_salt()?;
        let key = crypto::derive_key(secret, &salt)?;
        self.key = Some(key);
        self.salt = Some(salt);
        self.vault = Some(Vault::default());
        self.write()
    }

    fn unlock(&mut self, secret: Option<&str>) -> Result<(), String> {
        let secret = secret.ok_or_else(|| "master password required".to_string())?;
        let envelope = self.read_envelope()?;
        // Verifies the password and yields the plaintext (wiped on drop).
        let plaintext = crypto::open(secret, &envelope)?;
        let salt = base64_salt(&envelope)?;
        // Working key at the current pinned params — a legacy vault opened with
        // old params re-seals with the new ones on its next write.
        let key = crypto::derive_key(secret, &salt)?;
        let vault: Vault =
            serde_json::from_slice(&plaintext).map_err(|e| format!("corrupt vault: {e}"))?;
        self.key = Some(key);
        self.salt = Some(salt);
        self.vault = Some(vault);
        Ok(())
    }

    fn lock(&mut self) {
        // Dropping the Zeroizing key wipes the bytes.
        self.key = None;
        self.salt = None;
        self.vault = None;
    }

    fn list_all(&self) -> Result<Vec<CredentialSummary>, String> {
        let mut items: Vec<CredentialSummary> =
            self.vault_ref()?.items.iter().map(Self::summarize).collect();
        items.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(items)
    }

    fn list_for_origin(&self, origin: &Origin) -> Result<Vec<CredentialSummary>, String> {
        Ok(self
            .vault_ref()?
            .items
            .iter()
            .filter(|item| {
                origin::host_of(&item.url)
                    .map(|h| origin::host_matches(&origin.host, &h))
                    .unwrap_or(false)
            })
            .map(Self::summarize)
            .collect())
    }

    fn secret(&self, id: &str) -> Result<CredentialSecret, String> {
        self.vault_ref()?
            .items
            .iter()
            .find(|item| item.id == id)
            .map(|item| CredentialSecret {
                username: item.username.clone(),
                password: item.password.clone(),
                totp: item.totp.clone(),
            })
            .ok_or_else(|| "no such item".to_string())
    }

    fn save(&mut self, item: NewCredential) -> Result<CredentialSummary, String> {
        if self.key.is_none() {
            return Err("vault is locked".to_string());
        }
        let host = origin::host_of(&item.url).unwrap_or_default();
        let vault = self.vault.as_mut().ok_or_else(|| "vault is locked".to_string())?;

        // Update in place when the same host + username already exists.
        let existing = vault.items.iter_mut().find(|stored| {
            stored.username == item.username
                && origin::host_of(&stored.url).map(|h| h == host).unwrap_or(false)
                && !host.is_empty()
        });
        let summary = if let Some(stored) = existing {
            stored.password = item.password.clone();
            stored.title = item.title.clone();
            stored.url = item.url.clone();
            stored.updated = unix_now();
            LocalVault::summarize(stored)
        } else {
            let stored = StoredItem {
                id: new_id()?,
                title: item.title.clone(),
                username: item.username.clone(),
                password: item.password.clone(),
                url: item.url.clone(),
                totp: None,
                updated: unix_now(),
            };
            let summary = LocalVault::summarize(&stored);
            vault.items.push(stored);
            summary
        };
        self.write()?;
        Ok(summary)
    }

    fn update(&mut self, id: &str, item: NewCredential) -> Result<CredentialSummary, String> {
        let vault = self.vault.as_mut().ok_or_else(|| "vault is locked".to_string())?;
        let stored = vault
            .items
            .iter_mut()
            .find(|stored| stored.id == id)
            .ok_or_else(|| "no such item".to_string())?;
        stored.title = item.title.clone();
        stored.username = item.username.clone();
        stored.password = item.password.clone();
        stored.url = item.url.clone();
        stored.updated = unix_now();
        let summary = LocalVault::summarize(stored);
        self.write()?;
        Ok(summary)
    }

    fn delete(&mut self, id: &str) -> Result<(), String> {
        let vault = self.vault.as_mut().ok_or_else(|| "vault is locked".to_string())?;
        let before = vault.items.len();
        // Dropping the removed item zeroizes its password.
        vault.items.retain(|stored| stored.id != id);
        if vault.items.len() == before {
            return Err("no such item".to_string());
        }
        self.write()
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn base64_salt(env: &Envelope) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD
        .decode(&env.salt)
        .map_err(|_| "corrupt vault: salt".to_string())
}

fn new_id() -> Result<String, String> {
    let bytes = crypto::random_bytes(16)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
