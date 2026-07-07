use std::sync::LazyLock;
use std::time::Duration;

use serde_json::{json, Value};

use crate::cache::{get_or_fetch, TtlCache};
use crate::http::{self, err, get_json};

// TTL caches so co-mounted widgets and repeat polls share one upstream call and
// a throttled Steam serves last-good data. Keyed by App ID / query / key.
static STEAM_STATS: LazyLock<TtlCache<Value>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(60)));
static STEAM_PLAYERS: LazyLock<TtlCache<Value>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(20)));
static REDDIT: LazyLock<TtlCache<Value>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(300)));
static ITCH: LazyLock<TtlCache<Value>> = LazyLock::new(|| TtlCache::new(Duration::from_secs(300)));

/// Live Steam numbers for a game. All three endpoints are public, no API key.
#[tauri::command]
pub async fn steam_stats(appid: String) -> Result<Value, String> {
    let appid: u64 = appid.trim().parse().map_err(|_| "invalid App ID")?;
    get_or_fetch(&STEAM_STATS, &appid.to_string(), async move {
        let client = http::shared()?;
        // The three endpoints are independent; fetch them concurrently. Each
        // runs as its own task on the async runtime so they overlap on the wire.
        let details_url =
            format!("https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en");
        let reviews_url = format!(
            "https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all&num_per_page=0"
        );
        let players_url = format!(
            "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid={appid}"
        );
        let details =
            tauri::async_runtime::spawn(async move { get_json(client, &details_url).await });
        let reviews =
            tauri::async_runtime::spawn(async move { get_json(client, &reviews_url).await });
        let players =
            tauri::async_runtime::spawn(async move { get_json(client, &players_url).await });
        let details = details.await.ok().and_then(Result::ok).unwrap_or(Value::Null);
        let reviews = reviews.await.ok().and_then(Result::ok).unwrap_or(Value::Null);
        let players = players.await.ok().and_then(Result::ok).unwrap_or(Value::Null);

        Ok(json!({
            "details": details[appid.to_string()]["data"],
            "reviews": reviews["query_summary"],
            "players": players["response"]["player_count"],
        }))
    })
    .await
}

/// Just the live player count — the one Steam number cheap enough to poll
/// every 30 s. Returns the raw count (or null when Steam has none).
#[tauri::command]
pub async fn steam_players(appid: String) -> Result<Value, String> {
    let appid: u64 = appid.trim().parse().map_err(|_| "invalid App ID")?;
    get_or_fetch(&STEAM_PLAYERS, &appid.to_string(), async move {
        let client = http::shared()?;
        let url = format!(
            "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid={appid}"
        );
        let players = get_json(client, &url).await?;
        Ok(players["response"]["player_count"].clone())
    })
    .await
}

/// Recent posts mentioning the game. Reddit hard-403s its JSON API for
/// unauthenticated non-browser clients, but the RSS mirror of the same
/// search tolerates browser-shaped requests at polite rates — so we read
/// that and mine the subreddit back out of each post URL.
#[tauri::command]
pub async fn reddit_search(query: String) -> Result<Value, String> {
    let key = query.clone();
    get_or_fetch(&REDDIT, &key, async move {
        let client = http::shared()?;
        let response = client
            .get("https://www.reddit.com/search.rss")
            .query(&[("q", query.as_str()), ("sort", "new")])
            .header(reqwest::header::USER_AGENT, http::BROWSER_UA)
            .send()
            .await
            .map_err(err)?;
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err("Reddit is rate limiting".into());
        }
        let body = http::text_capped(response.error_for_status().map_err(err)?).await?;

        let posts: Vec<Value> = crate::news::parse_feed(&body)
            .into_iter()
            .map(|post| {
                json!({
                    "title": post.title,
                    "subreddit": subreddit_of(&post.url),
                    "createdUtc": post.date,
                    "url": post.url,
                })
            })
            .collect();

        Ok(json!(posts))
    })
    .await
}

/// `"r/HadesTheGame"` from a post permalink, or None off the beaten path.
fn subreddit_of(url: &str) -> Option<String> {
    let after = url.split("/r/").nth(1)?;
    let name = after.split('/').next()?;
    (!name.is_empty()).then(|| format!("r/{name}"))
}

#[cfg(test)]
mod tests {
    use super::subreddit_of;

    #[test]
    fn subreddit_comes_from_the_permalink() {
        assert_eq!(
            subreddit_of("https://www.reddit.com/r/HadesTheGame/comments/abc/post/").as_deref(),
            Some("r/HadesTheGame"),
        );
        assert_eq!(subreddit_of("https://www.reddit.com/user/someone/comments/x/"), None);
        assert_eq!(subreddit_of("https://www.reddit.com/r/"), None);
    }
}

/// The developer's games on itch.io, including views/downloads/purchases.
/// Needs an itch.io API key (Settings -> API keys).
#[tauri::command]
pub async fn itch_games(api_key: String) -> Result<Value, String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("missing itch.io API key".into());
    }
    let key = api_key.clone();
    get_or_fetch(&ITCH, &key, async move {
        let client = http::shared()?;
        // The key lands in the URL path; encode it so a stray character can't
        // break out of the segment.
        let response = get_json(
            client,
            &format!(
                "https://itch.io/api/1/{}/my-games",
                urlencoding::encode(&api_key)
            ),
        )
        .await?;

        if let Some(errors) = response["errors"].as_array() {
            let message = errors
                .iter()
                .filter_map(|e| e.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(if message.is_empty() {
                "itch.io rejected the request".into()
            } else {
                message
            });
        }

        Ok(response["games"].clone())
    })
    .await
}
