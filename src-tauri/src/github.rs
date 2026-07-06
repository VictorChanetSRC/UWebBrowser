//! GitHub integration for UWebBrowser's own repository: public repo stats
//! (stars, forks, open issues) and the release feed. Everything here is
//! read-only and unauthenticated — 60 requests/hour per IP — so responses
//! are cached in-process and every surface shares the same snapshot.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::DateTime;
use serde::Serialize;
use serde_json::Value;

use crate::http::{self, err};

/// The app's home repository, `owner/name`. Mirrored in src/lib/github.ts.
pub const REPO: &str = "VictorChanetSRC/UWebBrowser";

/// Widget polls, the Settings page and the star nudge together must fit in
/// the unauthenticated budget with plenty of headroom.
const TTL: Duration = Duration::from_secs(15 * 60);

/// Release notes are markdown for a tile, not an archive; cap what crosses IPC.
const NOTES_CAP: usize = 4_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStats {
    pub stars: u64,
    pub forks: u64,
    /// GitHub counts open pull requests in this number too.
    pub open_issues: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub name: String,
    pub tag: String,
    pub url: String,
    /// Unix seconds; None when GitHub omits or mangles the date.
    pub published: Option<i64>,
    /// Markdown body, truncated to {@link NOTES_CAP} characters.
    pub notes: String,
}

static STATS: Mutex<Option<(Instant, RepoStats)>> = Mutex::new(None);
static RELEASES: Mutex<Option<(Instant, Vec<Release>)>> = Mutex::new(None);

fn cached<T: Clone>(slot: &Mutex<Option<(Instant, T)>>) -> Option<T> {
    let guard = slot.lock().ok()?;
    match guard.as_ref() {
        Some((at, value)) if at.elapsed() < TTL => Some(value.clone()),
        _ => None,
    }
}

fn store<T: Clone>(slot: &Mutex<Option<(Instant, T)>>, value: &T) {
    if let Ok(mut guard) = slot.lock() {
        *guard = Some((Instant::now(), value.clone()));
    }
}

async fn api(path: &str) -> Result<Value, String> {
    let client = http::shared()?;
    let resp = client
        .get(format!("https://api.github.com/{path}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?;
    http::json_capped(resp).await
}

#[tauri::command]
pub async fn github_repo_stats() -> Result<RepoStats, String> {
    if let Some(hit) = cached(&STATS) {
        return Ok(hit);
    }
    let repo = api(&format!("repos/{REPO}")).await?;
    let stats = RepoStats {
        stars: repo["stargazers_count"].as_u64().unwrap_or(0),
        forks: repo["forks_count"].as_u64().unwrap_or(0),
        open_issues: repo["open_issues_count"].as_u64().unwrap_or(0),
    };
    store(&STATS, &stats);
    Ok(stats)
}

#[tauri::command]
pub async fn github_releases() -> Result<Vec<Release>, String> {
    if let Some(hit) = cached(&RELEASES) {
        return Ok(hit);
    }
    let list = api(&format!("repos/{REPO}/releases?per_page=8")).await?;
    let releases: Vec<Release> = list
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter(|r| !r["draft"].as_bool().unwrap_or(false))
                .map(parse_release)
                .collect()
        })
        .unwrap_or_default();
    store(&RELEASES, &releases);
    Ok(releases)
}

fn parse_release(r: &Value) -> Release {
    let tag = r["tag_name"].as_str().unwrap_or("").to_string();
    let name = match r["name"].as_str() {
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ => tag.clone(),
    };
    let notes: String = r["body"]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(NOTES_CAP)
        .collect();
    Release {
        name,
        tag,
        url: r["html_url"].as_str().unwrap_or("").to_string(),
        published: r["published_at"]
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.timestamp()),
        notes,
    }
}
