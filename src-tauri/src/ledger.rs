//! Shared on-disk persistence for the two revenue ledgers (`sales.rs` for
//! Steam, `itch.rs` for itch.io).
//!
//! Both keep the same shape: a day-keyed `BTreeMap` under the app data dir,
//! written atomically, pruned to a rolling window, and parsed from JSON that
//! upstream sometimes quotes as strings. This module owns that machinery once,
//! so the two ledgers cannot drift in their crash-safety guarantees — which
//! matters more here than elsewhere, because this is financial data the user
//! cannot re-derive: neither Steam nor itch exposes a backfillable history.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Seconds since the Unix epoch; 0 if the clock is before it.
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `<app data>/sales/<file>`, creating the directory. Both ledgers live here.
pub fn path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("sales");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

/// Read a ledger, falling back to the default on any failure. A ledger we can't
/// parse is one we resync, not a reason to leave the tile dead.
pub fn load_or_default<T: DeserializeOwned + Default>(path: &PathBuf) -> T {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Write-then-rename, so a crash mid-write can't leave a truncated ledger.
pub fn save_atomic<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Drop days past the rolling window. Keys are `YYYY-MM-DD`, and a `BTreeMap`
/// iterates them chronologically, so the oldest is always first.
pub fn prune_oldest<V>(days: &mut BTreeMap<String, V>, keep: usize) {
    while days.len() > keep {
        let Some(oldest) = days.keys().next().cloned() else {
            break;
        };
        days.remove(&oldest);
    }
}

/// Steam serialises 64-bit ids — and both stores serialise some money fields —
/// as JSON strings. Accept either shape rather than silently reading zero.
pub fn json_f64(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

/// Like [`json_f64`], but preserving integer precision when upstream sent an
/// integer (money in minor units can exceed f64's exact range).
pub fn json_i64(value: &Value) -> i64 {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|f| f as i64))
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0)
}

/// A non-negative [`json_f64`], truncated. Negatives and NaN collapse to 0.
pub fn json_u64(value: &Value) -> u64 {
    let n = json_f64(value);
    if n > 0.0 {
        n as u64
    } else {
        0
    }
}

/// Resets an "in flight" flag on drop, so a panic inside the guarded future
/// can't wedge the flag `true` and silently disable every later sync.
pub struct Flag(&'static std::sync::atomic::AtomicBool);

impl Flag {
    /// Claim the flag, or return `None` if another caller already holds it.
    pub fn claim(flag: &'static std::sync::atomic::AtomicBool) -> Option<Self> {
        if flag.swap(true, std::sync::atomic::Ordering::SeqCst) {
            None
        } else {
            Some(Self(flag))
        }
    }
}

impl Drop for Flag {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prune_drops_the_oldest_days_first() {
        let mut days: BTreeMap<String, ()> = BTreeMap::new();
        for i in 0..5 {
            days.insert(format!("2026-01-0{}", i + 1), ());
        }
        prune_oldest(&mut days, 3);
        assert_eq!(days.len(), 3);
        assert_eq!(days.keys().next().unwrap(), "2026-01-03");
    }

    #[test]
    fn prune_is_a_no_op_under_the_limit() {
        let mut days: BTreeMap<String, ()> = BTreeMap::new();
        days.insert("2026-01-01".into(), ());
        prune_oldest(&mut days, 3);
        assert_eq!(days.len(), 1);
    }

    #[test]
    fn json_numbers_accept_both_shapes() {
        assert_eq!(json_i64(&json!(42)), 42);
        assert_eq!(json_i64(&json!("42")), 42);
        assert_eq!(json_i64(&json!(null)), 0);
        assert_eq!(json_f64(&json!("1.5")), 1.5);
        assert_eq!(json_u64(&json!(-3)), 0);
        assert_eq!(json_u64(&json!("7")), 7);
    }

    #[test]
    fn flag_resets_when_the_guard_drops() {
        static F: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        {
            let guard = Flag::claim(&F).expect("first claim succeeds");
            assert!(Flag::claim(&F).is_none(), "second claim is refused");
            drop(guard);
        }
        assert!(Flag::claim(&F).is_some(), "flag freed on drop");
    }
}
