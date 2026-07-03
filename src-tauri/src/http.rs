//! Shared HTTP layer. One hardened reqwest client, built once and reused, so
//! the connection pool (and TLS sessions) survive across commands instead of
//! being torn down after every call.

use std::sync::OnceLock;
use std::time::Duration;

pub const USER_AGENT: &str = "UWebBrowser/0.1 (open source browser for Unreal Engine devs)";

/// Reddit hard-403s anything that doesn't look like a browser; its RSS
/// endpoints accept a browser UA at polite request rates. Only used there —
/// everything else gets our honest UA above.
pub const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// Uniform error mapping for the `Result<_, String>` command surface.
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// A hardened client: our UA, a 12s timeout, and rustls rather than the OS
/// stack — Epic's Cloudflare 403s the schannel TLS fingerprint but accepts
/// rustls.
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(12))
        .use_rustls_tls()
        .build()
        .map_err(err)
}

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// The process-wide client, built on first use. Callers share it so the
/// connection pool is reused.
pub fn shared() -> Result<&'static reqwest::Client, String> {
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let built = client()?;
    // A racing builder is harmless; whichever lands first wins, the other drops.
    Ok(CLIENT.get_or_init(|| built))
}

pub async fn get_json(c: &reqwest::Client, url: &str) -> Result<serde_json::Value, String> {
    c.get(url)
        .send()
        .await
        .map_err(err)?
        .json()
        .await
        .map_err(err)
}
