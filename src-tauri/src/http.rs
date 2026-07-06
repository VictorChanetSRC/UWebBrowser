//! Shared HTTP layer. One hardened reqwest client, built once and reused, so
//! the connection pool (and TLS sessions) survive across commands instead of
//! being torn down after every call.

use std::net::IpAddr;
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

/// Largest response body we'll buffer from any endpoint. The 12s timeout above
/// bounds *time*, not *bytes*, so without this a hostile or buggy server could
/// stream unbounded data and exhaust memory. 16 MiB comfortably covers every
/// feed / JSON / CRX response we consume.
pub const MAX_BODY: usize = 16 * 1024 * 1024;

/// Read a response body with a hard byte cap. Streams chunk-by-chunk (via
/// `Response::chunk`, no extra reqwest features) so we never buffer more than
/// `MAX_BODY`, and rejects early when the server declares an oversize length.
pub async fn body_capped(resp: reqwest::Response) -> Result<Vec<u8>, String> {
    body_capped_max(resp, MAX_BODY).await
}

/// [`body_capped`] with a caller-chosen ceiling. The default `MAX_BODY` fits
/// feeds/JSON, but a Chrome Web Store CRX can be far larger, so that path passes
/// its own (still bounded) cap rather than being clipped by the feed limit.
pub async fn body_capped_max(mut resp: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if resp.content_length().map_or(false, |len| len as usize > max) {
        return Err("response too large".to_string());
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(err)? {
        if buf.len() + chunk.len() > max {
            return Err("response too large".to_string());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// Size-capped `text()`.
pub async fn text_capped(resp: reqwest::Response) -> Result<String, String> {
    let bytes = body_capped(resp).await?;
    String::from_utf8(bytes).map_err(err)
}

/// Size-capped `json()`.
pub async fn json_capped<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
) -> Result<T, String> {
    let bytes = body_capped(resp).await?;
    serde_json::from_slice(&bytes).map_err(err)
}

/// Guard a caller-supplied URL before fetching it: only http(s), and never a
/// loopback / private / link-local host. `fetch_feed` fetches arbitrary URLs
/// from the user's feed list, so this keeps it from being aimed at internal
/// services (SSRF). Best-effort — it blocks literal-IP and localhost targets,
/// not hostnames that resolve into private space.
pub fn check_public_url(raw: &str) -> Result<(), String> {
    let parsed = url::Url::parse(raw).map_err(|_| "invalid URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("unsupported URL scheme: {other}")),
    }
    let host = parsed.host_str().ok_or("URL has no host")?;
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") {
        return Err("refusing to fetch a loopback host".to_string());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        let blocked = match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4.is_broadcast()
            }
            IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        };
        if blocked {
            return Err("refusing to fetch a private address".to_string());
        }
    }
    Ok(())
}

pub async fn get_json(c: &reqwest::Client, url: &str) -> Result<serde_json::Value, String> {
    let resp = c.get(url).send().await.map_err(err)?;
    json_capped(resp).await
}
