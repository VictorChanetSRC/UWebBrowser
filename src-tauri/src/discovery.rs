//! Where is this game published? One command, one platform per call, all
//! public endpoints, no API keys. Every check returns a PlatformHit; a
//! network or parse failure surfaces as Err so the UI can say "couldn't
//! check" instead of "not found".

use serde::Serialize;
use serde_json::{json, Value};

use crate::http::{self, err};

/// Twitch's public web client id. Rotates rarely; when it does, `twitch`
/// re-reads it from the homepage.
const TWITCH_CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";

#[derive(Serialize, Clone, Default)]
pub struct PlatformHit {
    pub found: bool,
    pub name: Option<String>,
    pub url: Option<String>,
    pub id: Option<String>,
}

struct Candidate {
    name: String,
    url: String,
    id: Option<String>,
}

/// Lowercased alphanumerics only, so "Hades II" matches "hades ii".
fn norm(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Pick the listing whose title equals the query; failing that, the first
/// one that starts with it (editions and platform tags trail the name).
/// Exact first matters: searching "Hades" must not land on "Hades II".
fn best(query: &str, candidates: Vec<Candidate>) -> PlatformHit {
    let q = norm(query);
    if q.is_empty() {
        return PlatformHit::default();
    }
    let picked = candidates
        .iter()
        .find(|c| norm(&c.name) == q)
        .or_else(|| candidates.iter().find(|c| norm(&c.name).starts_with(&q)));
    match picked {
        Some(c) => PlatformHit {
            found: true,
            name: Some(c.name.clone()),
            url: Some(c.url.clone()),
            id: c.id.clone(),
        },
        None => PlatformHit::default(),
    }
}

/// Collect every JSON node matching `pred`, depth-first. The storefront
/// responses nest results unpredictably; walking beats chasing their
/// exact shapes. Depth is bounded so a pathologically nested (or hostile)
/// response can't overflow the stack — real store payloads nest well under 64.
fn walk<'a>(v: &'a Value, out: &mut Vec<&'a Value>, pred: &dyn Fn(&Value) -> bool) {
    walk_depth(v, out, pred, 0)
}

fn walk_depth<'a>(
    v: &'a Value,
    out: &mut Vec<&'a Value>,
    pred: &dyn Fn(&Value) -> bool,
    depth: u32,
) {
    if pred(v) {
        out.push(v);
    }
    if depth >= 64 {
        return;
    }
    match v {
        Value::Array(items) => items
            .iter()
            .for_each(|item| walk_depth(item, out, pred, depth + 1)),
        Value::Object(map) => map
            .values()
            .for_each(|item| walk_depth(item, out, pred, depth + 1)),
        _ => {}
    }
}

#[tauri::command]
pub async fn check_platform(platform: String, query: String) -> Result<PlatformHit, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Err("empty game name".into());
    }
    let client = http::shared()?;
    match platform.as_str() {
        "steam" => steam(client, &q).await,
        "epic" => epic(client, &q).await,
        "xbox" => xbox(client, &q).await,
        "playstation" => playstation(client, &q).await,
        "nintendo" => nintendo(client, &q).await,
        "appstore" => appstore(client, &q).await,
        "googleplay" => googleplay(client, &q).await,
        "itch" => itch(client, &q).await,
        "twitch" => twitch(client, &q).await,
        other => Err(format!("unknown platform: {other}")),
    }
}

async fn steam(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    let resp = client
        .get("https://store.steampowered.com/api/storesearch/")
        .query(&[("term", q), ("l", "english"), ("cc", "US")])
        .send()
        .await
        .map_err(err)?;
    let v: Value = http::json_capped(resp).await?;

    let candidates = v["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let name = item["name"].as_str()?.to_string();
            let id = item["id"].as_u64()?;
            Some(Candidate {
                name,
                url: format!("https://store.steampowered.com/app/{id}"),
                id: Some(id.to_string()),
            })
        })
        .collect();
    Ok(best(q, candidates))
}

async fn epic(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    let body = json!({
        "query": "query($keywords: String!) { Catalog { searchStore(keywords: $keywords, category: \"games/edition/base\", count: 8) { elements { title urlSlug productSlug catalogNs { mappings(pageType: \"productHome\") { pageSlug } } } } } }",
        "variables": { "keywords": q }
    });
    let resp = client
        .post("https://store.epicgames.com/graphql")
        .json(&body)
        .send()
        .await
        .map_err(err)?;
    let v: Value = http::json_capped(resp).await?;

    let candidates = v["data"]["Catalog"]["searchStore"]["elements"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|el| {
            let title = el["title"].as_str()?.to_string();
            let slug = el["catalogNs"]["mappings"][0]["pageSlug"]
                .as_str()
                .or_else(|| el["productSlug"].as_str())
                .or_else(|| el["urlSlug"].as_str())?
                .trim_end_matches("/home")
                .to_string();
            Some(Candidate {
                name: title,
                url: format!("https://store.epicgames.com/en-US/p/{slug}"),
                id: Some(slug),
            })
        })
        .collect();
    Ok(best(q, candidates))
}

async fn xbox(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    let resp = client
        .get("https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest")
        .query(&[
            ("market", "US"),
            ("languages", "en-US"),
            ("query", q),
            ("productFamilyNames", "Games"),
        ])
        .send()
        .await
        .map_err(err)?;
    let v: Value = http::json_capped(resp).await?;

    let mut nodes = Vec::new();
    walk(&v, &mut nodes, &|n| {
        n["Title"].is_string() && n["ProductId"].is_string()
    });
    let candidates = nodes
        .into_iter()
        .map(|node| {
            let id = node["ProductId"].as_str().unwrap_or_default().to_string();
            Candidate {
                name: node["Title"].as_str().unwrap_or_default().to_string(),
                url: format!("https://www.xbox.com/en-US/games/store/_/{id}"),
                id: Some(id),
            }
        })
        .collect();
    Ok(best(q, candidates))
}

/// The PSN store search page server-renders its Apollo cache; full games
/// appear as Product nodes with an id and classification.
async fn playstation(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    let resp = client
        .get(format!(
            "https://store.playstation.com/en-us/search/{}",
            urlencode(q)
        ))
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .map_err(err)?;
    let html = http::text_capped(resp).await?;

    let state = html
        .split("__NEXT_DATA__")
        .nth(1)
        .and_then(|rest| rest.split_once('>'))
        .and_then(|(_, rest)| rest.split("</script>").next())
        .ok_or("no embedded state on the search page")?;
    let v: Value = serde_json::from_str(state).map_err(err)?;

    let mut nodes = Vec::new();
    walk(&v, &mut nodes, &|n| {
        n["__typename"].as_str() == Some("Product")
            && n["storeDisplayClassification"].as_str() == Some("FULL_GAME")
            && n["name"].is_string()
            && n["id"].is_string()
    });
    let candidates = nodes
        .into_iter()
        .map(|node| {
            let id = node["id"].as_str().unwrap_or_default().to_string();
            Candidate {
                name: node["name"].as_str().unwrap_or_default().to_string(),
                url: format!("https://store.playstation.com/en-us/product/{id}"),
                id: Some(id),
            }
        })
        .collect();
    Ok(best(q, candidates))
}

async fn nintendo(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    let resp = client
        .get("https://search.nintendo-europe.com/en/select")
        .query(&[
            ("q", q),
            ("fq", "type:GAME"),
            ("rows", "8"),
            ("start", "0"),
            ("wt", "json"),
        ])
        .send()
        .await
        .map_err(err)?;
    let v: Value = http::json_capped(resp).await?;

    let candidates = v["response"]["docs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|doc| {
            Some(Candidate {
                name: doc["title"].as_str()?.to_string(),
                url: format!("https://www.nintendo.co.uk{}", doc["url"].as_str()?),
                id: None,
            })
        })
        .collect();
    Ok(best(q, candidates))
}

async fn appstore(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    let resp = client
        .get("https://itunes.apple.com/search")
        .query(&[("term", q), ("entity", "software"), ("limit", "8")])
        .send()
        .await
        .map_err(err)?;
    let v: Value = http::json_capped(resp).await?;

    let candidates = v["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(Candidate {
                name: item["trackName"].as_str()?.to_string(),
                url: item["trackViewUrl"].as_str()?.to_string(),
                id: item["trackId"].as_u64().map(|id| id.to_string()),
            })
        })
        .collect();
    Ok(best(q, candidates))
}

/// Google Play has no public search API; scan the search page for a details
/// link with the game's name rendered nearby. Best effort by design.
async fn googleplay(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    let resp = client
        .get("https://play.google.com/store/search")
        .query(&[("q", q), ("c", "apps"), ("hl", "en"), ("gl", "US")])
        .send()
        .await
        .map_err(err)?;
    let html = http::text_capped(resp).await?.to_lowercase();

    let needle = q.to_lowercase();
    let marker = "/store/apps/details?id=";
    let mut pos = 0;
    while let Some(at) = html[pos..].find(marker) {
        let start = pos + at + marker.len();
        let end = html[start..]
            .find(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '_')
            .map(|i| start + i)
            .unwrap_or(html.len());
        let id = &html[start..end];
        let win_start = floor_boundary(&html, start.saturating_sub(400));
        let win_end = ceil_boundary(&html, (end + 400).min(html.len()));
        if !id.is_empty() && html[win_start..win_end].contains(&needle) {
            return Ok(PlatformHit {
                found: true,
                name: Some(q.to_string()),
                url: Some(format!(
                    "https://play.google.com/store/apps/details?id={id}"
                )),
                id: Some(id.to_string()),
            });
        }
        pos = end;
    }
    Ok(PlatformHit::default())
}

/// itch.io search is HTML only; game cards carry `game_link` anchors, the
/// title one has the name as plain text.
async fn itch(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    let resp = client
        .get("https://itch.io/search")
        .query(&[("q", q)])
        .send()
        .await
        .map_err(err)?;
    let html = http::text_capped(resp).await?;

    let mut candidates = Vec::new();
    let mut pos = 0;
    while let Some(rel) = html[pos..].find("game_link") {
        let at = pos + rel;
        pos = at + "game_link".len();
        let Some(a_start) = html[..at].rfind("<a ") else { continue };
        let Some(open_rel) = html[at..].find('>') else { break };
        let open_end = at + open_rel;
        let Some(close_rel) = html[open_end..].find("</a>") else { break };
        let close = open_end + close_rel;

        let inner = html[open_end + 1..close]
            .replace("&amp;", "&")
            .replace("&#39;", "'")
            .replace("&quot;", "\"");
        let inner = inner.trim();
        // Thumbnail anchors wrap an <img>; the title anchor is plain text.
        if inner.contains('<') || inner.is_empty() {
            continue;
        }
        let href = html[a_start..open_end]
            .split("href=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next());
        if let Some(href) = href {
            if href.contains("itch.io") {
                candidates.push(Candidate {
                    name: inner.to_string(),
                    url: href.to_string(),
                    id: None,
                });
            }
        }
    }
    Ok(best(q, candidates))
}

/// A client id discovered from the homepage after the baked-in one rotated,
/// remembered for the session so we don't re-scrape the homepage on every call.
static DISCOVERED_TWITCH_ID: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Twitch category lookup via the public web client's GraphQL endpoint.
/// If the baked-in client id has rotated, pull the current one from the
/// homepage, remember it, and retry once.
async fn twitch(client: &reqwest::Client, q: &str) -> Result<PlatformHit, String> {
    // Prefer an id already discovered this session over the (possibly stale)
    // baked-in constant.
    let primary = DISCOVERED_TWITCH_ID
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(|| TWITCH_CLIENT_ID.to_string());
    match twitch_gql(client, q, &primary).await {
        Ok(hit) => Ok(hit),
        Err(_) => {
            let id = twitch_client_id(client).await?;
            if let Ok(mut g) = DISCOVERED_TWITCH_ID.lock() {
                *g = Some(id.clone());
            }
            twitch_gql(client, q, &id).await
        }
    }
}

async fn twitch_gql(
    client: &reqwest::Client,
    q: &str,
    client_id: &str,
) -> Result<PlatformHit, String> {
    let body = json!({
        "query": "query($q: String!) { searchCategories(query: $q, first: 8) { edges { node { name slug } } } }",
        "variables": { "q": q }
    });
    let response = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-Id", client_id)
        .json(&body)
        .send()
        .await
        .map_err(err)?;
    if !response.status().is_success() {
        return Err(format!("twitch gql returned {}", response.status()));
    }
    let v: Value = http::json_capped(response).await?;

    let candidates = v["data"]["searchCategories"]["edges"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|edge| {
            let node = &edge["node"];
            let slug = node["slug"].as_str()?.to_string();
            Some(Candidate {
                name: node["name"].as_str()?.to_string(),
                url: format!("https://www.twitch.tv/directory/category/{slug}"),
                id: Some(slug),
            })
        })
        .collect();
    Ok(best(q, candidates))
}

async fn twitch_client_id(client: &reqwest::Client) -> Result<String, String> {
    let resp = client
        .get("https://www.twitch.tv/")
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .map_err(err)?;
    let html = http::text_capped(resp).await?;
    ["clientId=\"", "clientId:\"", "clientID=\""]
        .iter()
        .find_map(|marker| {
            html.split(marker)
                .nth(1)
                .and_then(|rest| rest.split('"').next())
                .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
        })
        .map(str::to_string)
        .ok_or_else(|| "no client id on the Twitch homepage".into())
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

fn floor_boundary(s: &str, mut i: usize) -> usize {
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_boundary(s: &str, mut i: usize) -> usize {
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}
