//! Vault-at-rest crypto for the local backend.
//!
//! A master password is stretched with Argon2id into a 256-bit key; the vault
//! JSON is sealed with XChaCha20-Poly1305. Salt and nonce are stored in the
//! clear alongside the ciphertext (standard practice — they are not secret).
//! The derived key lives only in memory and is wrapped in `Zeroizing` so it is
//! wiped when dropped.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const KEY_LEN: usize = 32;

// Argon2id cost, pinned rather than left to the library default (which a
// dependency bump could silently change) and recorded in every envelope so old
// vaults keep opening with the parameters that sealed them. 64 MiB / 3 passes
// is comfortably above current interactive-login guidance.
const ARGON2_M_COST: u32 = 64 * 1024; // 64 MiB, in KiB
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 1;

/// The on-disk envelope. Everything here is safe to store unencrypted.
#[derive(Serialize, Deserialize)]
pub struct Envelope {
    pub v: u8,
    pub kdf: String,
    /// Argon2 memory/time/parallelism the key was derived with. Absent on v1
    /// vaults sealed before params were pinned — those fall back to the library
    /// default so they still open.
    #[serde(default)]
    pub m: Option<u32>,
    #[serde(default)]
    pub t: Option<u32>,
    #[serde(default)]
    pub p: Option<u32>,
    pub salt: String,
    pub nonce: String,
    pub ct: String,
}

pub type Key = Zeroizing<[u8; KEY_LEN]>;

pub fn random_bytes(len: usize) -> Result<Vec<u8>, String> {
    let mut buf = vec![0u8; len];
    getrandom::getrandom(&mut buf).map_err(|e| format!("rng failure: {e}"))?;
    Ok(buf)
}

fn argon2_with(m: u32, t: u32, p: u32) -> Result<Argon2<'static>, String> {
    let params = Params::new(m, t, p, Some(KEY_LEN)).map_err(|e| format!("bad argon2 params: {e}"))?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

fn derive_with(argon: &Argon2, password: &str, salt: &[u8]) -> Result<Key, String> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|e| format!("key derivation failed: {e}"))?;
    Ok(key)
}

/// Derive the vault key from a master password and salt with Argon2id at the
/// current pinned parameters. Used for new vaults and for the working key held
/// while a vault is unlocked (so re-sealing always records these params).
pub fn derive_key(password: &str, salt: &[u8]) -> Result<Key, String> {
    derive_with(
        &argon2_with(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST)?,
        password,
        salt,
    )
}

/// Seal plaintext under a freshly derived key, returning the full envelope.
/// `salt` is the salt that produced `key`; it is recorded so the same key can
/// be re-derived on unlock.
pub fn seal(key: &Key, salt: &[u8], plaintext: &[u8]) -> Result<Envelope, String> {
    let nonce = random_bytes(NONCE_LEN)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| "bad key length".to_string())?;
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext)
        .map_err(|_| "encryption failed".to_string())?;
    Ok(Envelope {
        v: 2,
        kdf: "argon2id".to_string(),
        m: Some(ARGON2_M_COST),
        t: Some(ARGON2_T_COST),
        p: Some(ARGON2_P_COST),
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(&nonce),
        ct: STANDARD.encode(&ct),
    })
}

/// Re-derive the key from `password` + the envelope's recorded parameters and
/// decrypt it, returning the plaintext (wiped on drop). A wrong password fails
/// the AEAD tag check and surfaces as an error, never as garbage. The caller
/// derives its own working key with [`derive_key`] so re-sealing always uses
/// the current pinned params (migrating a legacy vault on its next write).
pub fn open(password: &str, env: &Envelope) -> Result<Zeroizing<Vec<u8>>, String> {
    let salt = STANDARD
        .decode(&env.salt)
        .map_err(|_| "corrupt vault: salt".to_string())?;
    let nonce = STANDARD
        .decode(&env.nonce)
        .map_err(|_| "corrupt vault: nonce".to_string())?;
    let ct = STANDARD
        .decode(&env.ct)
        .map_err(|_| "corrupt vault: ciphertext".to_string())?;
    if nonce.len() != NONCE_LEN {
        return Err("corrupt vault: nonce length".to_string());
    }
    // Legacy v1 vaults carry no params; they were sealed with the argon2 crate
    // default, so open them with it.
    let argon = match (env.m, env.t, env.p) {
        (Some(m), Some(t), Some(p)) => argon2_with(m, t, p)?,
        _ => Argon2::default(),
    };
    let key = derive_with(&argon, password, &salt)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| "bad key length".to_string())?;
    let plaintext = cipher
        .decrypt(XNonce::from_slice(&nonce), ct.as_ref())
        .map_err(|_| "wrong master password".to_string())?;
    Ok(Zeroizing::new(plaintext))
}

/// Convenience: mint a new salt for a first-time vault.
pub fn new_salt() -> Result<Vec<u8>, String> {
    random_bytes(SALT_LEN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let salt = new_salt().unwrap();
        let key = derive_key("hunter2", &salt).unwrap();
        let env = seal(&key, &salt, b"{\"items\":[]}").unwrap();
        let pt = open("hunter2", &env).unwrap();
        assert_eq!(pt.as_slice(), b"{\"items\":[]}");
    }

    #[test]
    fn wrong_password_rejected() {
        let salt = new_salt().unwrap();
        let key = derive_key("right", &salt).unwrap();
        let env = seal(&key, &salt, b"secret").unwrap();
        assert!(open("wrong", &env).is_err());
    }

    #[test]
    fn opens_legacy_v1_envelope() {
        // A vault sealed before params were pinned: key from the library
        // default, no m/t/p recorded. It must still open (no user lock-out).
        let salt = new_salt().unwrap();
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        Argon2::default()
            .hash_password_into(b"legacy", &salt, key.as_mut())
            .unwrap();
        let nonce = random_bytes(NONCE_LEN).unwrap();
        let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref()).unwrap();
        let ct = cipher
            .encrypt(XNonce::from_slice(&nonce), b"{\"items\":[]}".as_ref())
            .unwrap();
        let env = Envelope {
            v: 1,
            kdf: "argon2id".to_string(),
            m: None,
            t: None,
            p: None,
            salt: STANDARD.encode(&salt),
            nonce: STANDARD.encode(&nonce),
            ct: STANDARD.encode(&ct),
        };
        let pt = open("legacy", &env).unwrap();
        assert_eq!(pt.as_slice(), b"{\"items\":[]}");
    }
}
