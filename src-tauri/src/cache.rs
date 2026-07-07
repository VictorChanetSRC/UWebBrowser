//! A tiny in-process TTL cache for outbound API responses.
//!
//! The dashboard polls Steam, Reddit, itch, Epic and RSS feeds on timers; the
//! same call is often issued by several widgets at once. Without a cache each
//! poll is a live request — wasted bandwidth and a real risk of an upstream
//! (Steam especially) rate-limiting or IP-banning a browser left open all day.
//!
//! [`get_or_fetch`] serves a fresh cached value when one exists, and on a fetch
//! error falls back to the last-good value (any age) so a transient upstream
//! throttle shows stale-but-valid data instead of an empty widget. `github.rs`
//! keeps its own single-slot caches; everything else keyed by argument goes
//! through here.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

struct Entry<T> {
    fetched_at: Instant,
    value: T,
}

/// A keyed cache with a single freshness window. `T` is whatever a command
/// returns (already owned/serializable), cloned on read.
pub struct TtlCache<T> {
    ttl: Duration,
    inner: Mutex<HashMap<String, Entry<T>>>,
}

impl<T: Clone> TtlCache<T> {
    /// Construct a cache with the given freshness window. Not `const`
    /// (`HashMap::new` isn't const), so hold statics in a `LazyLock`.
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Entry<T>>> {
        // A poisoned cache lock is harmless — the map is just memoized data — so
        // recover the guard rather than propagating the panic.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A cached value newer than the TTL, if any.
    pub fn fresh(&self, key: &str) -> Option<T> {
        let map = self.lock();
        map.get(key)
            .filter(|e| e.fetched_at.elapsed() < self.ttl)
            .map(|e| e.value.clone())
    }

    /// The last stored value regardless of age (the fallback on a fetch error).
    pub fn stale(&self, key: &str) -> Option<T> {
        self.lock().get(key).map(|e| e.value.clone())
    }

    pub fn put(&self, key: &str, value: T) {
        self.lock().insert(
            key.to_string(),
            Entry {
                fetched_at: Instant::now(),
                value,
            },
        );
    }
}

/// Return a fresh cached value, or run `fetch` and cache it. On a fetch error,
/// fall back to the last-good value if we have one; only surface the error when
/// the cache is cold. This means a rate-limited upstream serves slightly stale
/// data instead of failing, and repeat calls within the TTL do no network I/O.
pub async fn get_or_fetch<T, Fut>(
    cache: &TtlCache<T>,
    key: &str,
    fetch: Fut,
) -> Result<T, String>
where
    T: Clone,
    Fut: Future<Output = Result<T, String>>,
{
    if let Some(hit) = cache.fresh(key) {
        return Ok(hit);
    }
    match fetch.await {
        Ok(value) => {
            cache.put(key, value.clone());
            Ok(value)
        }
        Err(e) => cache.stale(key).ok_or(e),
    }
}
