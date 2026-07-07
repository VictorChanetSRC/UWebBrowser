//! Feeds for the home dashboard: generic RSS/Atom parsing plus the public
//! Steam and Epic storefront JSON endpoints. Everything here is read-only
//! and unauthenticated.

use std::sync::LazyLock;
use std::time::Duration;

use chrono::DateTime;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;
use serde_json::{json, Value};

use crate::cache::{get_or_fetch, TtlCache};
use crate::http::{self, err, get_json};

/// Widgets render at most a screenful; don't ship a whole archive across IPC.
const FEED_CAP: usize = 30;

// TTL caches: dedupe co-mounted widgets, skip refetch on dashboard remount, and
// serve last-good on an upstream hiccup. Keyed by feed URL / Steam category.
static FEEDS: LazyLock<TtlCache<Vec<FeedItem>>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(900)));
static FEATURED: LazyLock<TtlCache<Value>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(1800)));
static EPIC: LazyLock<TtlCache<Value>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(1800)));

#[derive(Serialize, Clone)]
pub struct FeedItem {
    pub(crate) title: String,
    pub(crate) url: String,
    /// Unix seconds; None when the feed omits or mangles the date.
    pub(crate) date: Option<i64>,
}

/// Fetch and parse an RSS 2.0 or Atom feed into a flat item list.
#[tauri::command]
pub async fn fetch_feed(url: String) -> Result<Vec<FeedItem>, String> {
    http::check_public_url(&url)?;
    let key = url.clone();
    get_or_fetch(&FEEDS, &key, async move {
        let client = http::shared()?;
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(err)?
            .error_for_status()
            .map_err(err)?;
        let body = http::text_capped(resp).await?;
        Ok(parse_feed(&body))
    })
    .await
}

/// Which sub-element of the current item we are collecting text for.
enum Field {
    Title,
    Link,
    Date,
    Updated,
}

/// One pass over the XML, collecting title/link/date per `<item>`/`<entry>`.
/// Namespace prefixes are ignored (`dc:date` reads as `date`), CDATA titles
/// are unwrapped, and Atom `<link href>` beats element text.
pub(crate) fn parse_feed(xml: &str) -> Vec<FeedItem> {
    let mut reader = Reader::from_str(xml);
    let mut items = Vec::new();
    let mut in_item = false;
    let (mut title, mut link, mut date, mut updated) =
        (String::new(), String::new(), String::new(), String::new());
    let mut capture: Option<Field> = None;
    let mut buf = String::new();

    loop {
        match reader.read_event() {
            Err(_) | Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => {
                let name = e.local_name();
                if !in_item {
                    if matches!(name.as_ref(), b"item" | b"entry") {
                        in_item = true;
                        title.clear();
                        link.clear();
                        date.clear();
                        updated.clear();
                    }
                    continue;
                }
                buf.clear();
                capture = match name.as_ref() {
                    b"title" => Some(Field::Title),
                    b"link" => {
                        // Atom carries the URL as an attribute; RSS as text.
                        if let Some(href) = atom_href(&e) {
                            if link.is_empty() {
                                link = href;
                            }
                            None
                        } else {
                            Some(Field::Link)
                        }
                    }
                    b"pubDate" | b"published" | b"date" => Some(Field::Date),
                    b"updated" => Some(Field::Updated),
                    _ => None,
                };
            }
            Ok(Event::Empty(e)) if in_item => {
                if e.local_name().as_ref() == b"link" {
                    if let Some(href) = atom_href(&e) {
                        if link.is_empty() {
                            link = href;
                        }
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if capture.is_some() {
                    buf.push_str(&t.unescape().unwrap_or_default());
                }
            }
            Ok(Event::CData(t)) => {
                if capture.is_some() {
                    buf.push_str(&String::from_utf8_lossy(&t.into_inner()));
                }
            }
            Ok(Event::End(e)) => {
                if let Some(field) = capture.take() {
                    let text = buf.trim().to_string();
                    if !text.is_empty() {
                        match field {
                            Field::Title if title.is_empty() => title = text,
                            Field::Link if link.is_empty() => link = text,
                            Field::Date if date.is_empty() => date = text,
                            Field::Updated if updated.is_empty() => updated = text,
                            _ => {}
                        }
                    }
                }
                if in_item && matches!(e.local_name().as_ref(), b"item" | b"entry") {
                    in_item = false;
                    let clean = clean_title(&title);
                    if !clean.is_empty() && !link.is_empty() {
                        items.push(FeedItem {
                            title: clean,
                            url: link.clone(),
                            // `updated` only fills in when nothing better exists.
                            date: parse_date(&date).or_else(|| parse_date(&updated)),
                        });
                        if items.len() >= FEED_CAP {
                            break;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    items
}

/// The `href` of an Atom `<link>`, unless `rel` points somewhere other than
/// the article (`self`, `enclosure`, ...).
fn atom_href(e: &BytesStart) -> Option<String> {
    let mut href = None;
    let mut is_alternate = true;
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"href" => href = attr.unescape_value().ok().map(|v| v.into_owned()),
            b"rel" => {
                is_alternate = attr.unescape_value().ok().as_deref() == Some("alternate");
            }
            _ => {}
        }
    }
    if is_alternate {
        href
    } else {
        None
    }
}

/// Feed titles sometimes arrive wrapped in markup (Epic's Atom feed ships an
/// escaped `<p>` inside `<title>`) or carry HTML entities through CDATA.
/// Reduce them to plain text.
fn clean_title(raw: &str) -> String {
    let mut text = String::with_capacity(raw.len());
    let mut in_tag = false;
    for c in raw.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => text.push(c),
            _ => {}
        }
    }
    decode_entities(text.trim())
}

/// The five XML entities plus numeric character references — enough for
/// headline text; anything unrecognized passes through untouched.
fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        // An entity is short; a far-away ';' means this '&' is literal text.
        // Scan bytes (not a `&str` slice) so a multi-byte char straddling the
        // 12-byte window can't panic on a non-char-boundary slice — feed titles
        // carry emoji and accented text, so this path is reachable.
        let window = rest.len().min(12);
        if let Some(end) = rest.as_bytes()[..window].iter().position(|&b| b == b';') {
            let entity = &rest[1..end];
            let decoded = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                _ => entity.strip_prefix('#').and_then(|num| {
                    let code = match num.strip_prefix('x').or_else(|| num.strip_prefix('X')) {
                        Some(hex) => u32::from_str_radix(hex, 16).ok(),
                        None => num.parse().ok(),
                    };
                    code.and_then(char::from_u32)
                }),
            };
            if let Some(c) = decoded {
                out.push(c);
                rest = &rest[end + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &rest[1..];
    }
    out.push_str(rest);
    out
}

/// RSS uses RFC 2822 dates, Atom RFC 3339; some feeds get creative — those
/// fall through to None rather than failing the whole fetch.
fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc2822(s)
        .or_else(|_| DateTime::parse_from_rfc3339(s))
        .ok()
        .map(|d| d.timestamp())
}

/// One list from Steam's front-page categories. Prices are USD cents.
/// Coming-soon entries are enriched with their planned release date, which
/// only lives on the per-app details endpoint.
#[tauri::command]
pub async fn steam_featured(category: String) -> Result<Value, String> {
    const KNOWN: [&str; 4] = ["coming_soon", "new_releases", "top_sellers", "specials"];
    if !KNOWN.contains(&category.as_str()) {
        return Err("unknown Steam category".into());
    }
    let key = category.clone();
    get_or_fetch(&FEATURED, &key, async move {
        let client = http::shared()?;
        let response = get_json(
            client,
            "https://store.steampowered.com/api/featuredcategories?cc=us&l=en",
        )
        .await?;

        let mut items: Vec<Value> = response[&category]["items"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let appid = item["id"].as_u64()?;
                        Some(json!({
                            "appid": appid,
                            "name": item["name"],
                            "image": item["small_capsule_image"],
                            "largeImage": item["large_capsule_image"],
                            "discounted": item["discounted"],
                            "discountPercent": item["discount_percent"],
                            "finalPrice": item["final_price"],
                            "originalPrice": item["original_price"],
                            "release": Value::Null,
                        }))
                    })
                    .collect()
            })
            .unwrap_or_default();

        if category == "coming_soon" {
            // One details call per app to fill the release date; `filters` keeps
            // each payload tiny. Run in bounded batches instead of firing all at
            // once — `appdetails` is Steam's most rate-limited endpoint, and an
            // unbounded burst risks a per-IP throttle. A miss leaves it null.
            const BATCH: usize = 5;
            let appids: Vec<u64> = items
                .iter()
                .filter_map(|item| item["appid"].as_u64())
                .collect();
            for chunk in appids.chunks(BATCH) {
                let lookups: Vec<_> = chunk
                    .iter()
                    .copied()
                    .map(|appid| {
                        tauri::async_runtime::spawn(async move {
                            let url = format!(
                                "https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en&filters=release_date"
                            );
                            let details = get_json(http::shared().ok()?, &url).await.ok()?;
                            Some((appid, details[appid.to_string()]["data"]["release_date"]["date"].clone()))
                        })
                    })
                    .collect();
                for lookup in lookups {
                    if let Ok(Some((appid, date))) = lookup.await {
                        if let Some(item) = items.iter_mut().find(|i| i["appid"] == appid) {
                            item["release"] = date;
                        }
                    }
                }
            }
        }

        Ok(json!(items))
    })
    .await
}

/// Epic Games Store giveaway rotation: what's free right now and what's
/// queued next. Free-now entries sort first, then by start date.
#[tauri::command]
pub async fn epic_free_games() -> Result<Value, String> {
    get_or_fetch(&EPIC, "", epic_free_games_uncached()).await
}

async fn epic_free_games_uncached() -> Result<Value, String> {
    let client = http::shared()?;
    let response = get_json(
        client,
        "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US",
    )
    .await?;

    let elements = response["data"]["Catalog"]["searchStore"]["elements"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut games: Vec<Value> = Vec::new();
    for element in &elements {
        let promos = &element["promotions"];
        if promos.is_null() {
            continue;
        }
        let current = &promos["promotionalOffers"][0]["promotionalOffers"][0];
        let upcoming = &promos["upcomingPromotionalOffers"][0]["promotionalOffers"][0];
        // "Free now" shows as an active promo that drops the price to zero.
        let free_now = !current.is_null()
            && element["price"]["totalPrice"]["discountPrice"].as_u64() == Some(0);
        let (status, start, end) = if free_now {
            ("free", &current["startDate"], &current["endDate"])
        } else if !upcoming.is_null() {
            ("upcoming", &upcoming["startDate"], &upcoming["endDate"])
        } else {
            continue;
        };

        let slug = element["catalogNs"]["mappings"][0]["pageSlug"]
            .as_str()
            .or_else(|| element["productSlug"].as_str())
            .or_else(|| element["urlSlug"].as_str());
        let url = slug
            .map(|s| format!("https://store.epicgames.com/en-US/p/{s}"))
            .unwrap_or_else(|| "https://store.epicgames.com/en-US/free-games".into());
        let image = element["keyImages"]
            .as_array()
            .and_then(|imgs| {
                imgs.iter()
                    .find(|k| k["type"] == "OfferImageWide")
                    .or_else(|| imgs.first())
            })
            .map(|k| k["url"].clone())
            .unwrap_or(Value::Null);

        games.push(json!({
            "title": element["title"],
            "url": url,
            "image": image,
            "status": status,
            "startDate": start,
            "endDate": end,
            "originalPrice": element["price"]["totalPrice"]["originalPrice"],
        }));
    }

    games.sort_by(|a, b| {
        let rank = |v: &Value| u8::from(v["status"] != "free");
        rank(a).cmp(&rank(b)).then_with(|| {
            let start = |v: &Value| v["startDate"].as_str().unwrap_or("").to_owned();
            start(a).cmp(&start(b))
        })
    });

    Ok(json!(games))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The RSS 2.0 shape Game Developer / GamesIndustry / Steam news ship:
    /// CDATA-wrapped title and link, RFC 2822 pubDate, dc: extras.
    #[test]
    fn parses_rss_with_cdata() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
              <channel>
                <title>Game Developer</title>
                <link>https://www.gamedeveloper.com</link>
                <pubDate>Thu, 02 Jul 2026 12:00:00 GMT</pubDate>
                <item>
                  <title><![CDATA[Union workers establish hardship fund &#8212; devs impacted]]></title>
                  <link><![CDATA[https://example.com/a]]></link>
                  <description><![CDATA[Ignored.]]></description>
                  <pubDate>Thu, 02 Jul 2026 10:20:16 GMT</pubDate>
                  <dc:creator>Chris Kerr</dc:creator>
                </item>
                <item>
                  <title>Plain &amp; simple</title>
                  <link>https://example.com/b</link>
                </item>
              </channel>
            </rss>"#;
        let items = parse_feed(xml);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Union workers establish hardship fund — devs impacted");
        assert_eq!(items[0].url, "https://example.com/a");
        assert_eq!(items[0].date, Some(1782987616));
        assert_eq!(items[1].title, "Plain & simple");
        assert_eq!(items[1].date, None);
    }

    /// The Atom shape Epic's Unreal feed ships: escaped HTML inside titles,
    /// href-carrying links, and RFC 2822 dates despite being Atom.
    #[test]
    fn parses_atom_with_markup_titles() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <title>Unreal Engine</title>
              <link href="https://www.unrealengine.com/rss" rel="self"></link>
              <updated>2026-07-01T00:00:00Z</updated>
              <entry>
                <title>&lt;p&gt;June&#8217;s Epic learning content&lt;/p&gt;</title>
                <content type="html">ignored</content>
                <published>Fri, 26 Jun 2026 00:00:00 GMT</published>
                <updated>Fri, 26 Jun 2026 00:00:00 GMT</updated>
                <link href="https://www.unrealengine.com/learning-june" rel="alternate"></link>
              </entry>
              <entry>
                <title>RFC 3339 dates work too</title>
                <link href="https://example.com/entry"/>
                <updated>2026-06-20T08:30:00Z</updated>
              </entry>
            </feed>"#;
        let items = parse_feed(xml);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "June’s Epic learning content");
        assert_eq!(items[0].url, "https://www.unrealengine.com/learning-june");
        assert_eq!(items[0].date, Some(1782432000));
        assert_eq!(items[1].url, "https://example.com/entry");
        assert_eq!(items[1].date, Some(1781944200));
    }

    /// The Atom shape Reddit's search RSS ships: self-closing links with no
    /// rel, titles after content, and escaped HTML in <content> that must
    /// not bleed into any field.
    #[test]
    fn parses_reddit_search_atom() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <category term=" reddit.com" label="r/ reddit.com"/>
              <link rel="self" href="https://www.reddit.com/search.rss?q=x" type="application/atom+xml" />
              <link rel="alternate" href="https://www.reddit.com/search?q=x" type="text/html" />
              <title>reddit search</title>
              <entry>
                <author><name>/u/someone</name><uri>https://www.reddit.com/user/someone</uri></author>
                <content type="html">&lt;div&gt;Escaped markup that must stay out of the title&lt;/div&gt;</content>
                <id>t3_abc</id>
                <link href="https://www.reddit.com/r/HadesTheGame/comments/abc/great_run/" />
                <updated>2026-07-02T16:29:06+00:00</updated>
                <title>Finally beat Hades on 32 heat</title>
              </entry>
            </feed>"#;
        let items = parse_feed(xml);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Finally beat Hades on 32 heat");
        assert_eq!(
            items[0].url,
            "https://www.reddit.com/r/HadesTheGame/comments/abc/great_run/",
        );
        assert_eq!(items[0].date, Some(1783009746));
    }

    #[test]
    fn feed_is_capped() {
        let items: String = (0..40)
            .map(|i| format!("<item><title>T{i}</title><link>https://e.com/{i}</link></item>"))
            .collect();
        let xml = format!("<rss><channel>{items}</channel></rss>");
        assert_eq!(parse_feed(&xml).len(), FEED_CAP);
    }

    #[test]
    fn literal_ampersands_survive_entity_decode() {
        assert_eq!(decode_entities("Q&A at GDC"), "Q&A at GDC");
        assert_eq!(decode_entities("A &#x27;quoted&#x27; word"), "A 'quoted' word");
    }

    #[test]
    fn multibyte_char_across_scan_window_does_not_panic() {
        // '&' + 10 ASCII puts a 4-byte emoji starting at byte 11, straddling the
        // 12-byte entity-scan window. The old `&str` slice at byte 12 panicked on
        // the non-char-boundary; the byte scan must pass it through untouched.
        let s = "&aaaaaaaaaa\u{1F600} devs";
        assert_eq!(decode_entities(s), s);
        // A real entity immediately followed by a multi-byte char still decodes.
        assert_eq!(decode_entities("&amp;\u{1F600}"), "&\u{1F600}");
    }
}
