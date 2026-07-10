//! The developer's own Steam sales, from `IPartnerFinancialsService`.
//!
//! Three things make this module unlike the rest of `stats.rs`:
//!
//! 1. **The credential is a financial one.** It lives in the OS credential
//!    store, never in `localStorage` and never back across the IPC boundary —
//!    the frontend can ask *whether* we're connected, never *with what*. Every
//!    partner request is issued from here.
//! 2. **The data is persisted, not cached.** Revenue history is the product,
//!    and the changed-dates cursor is inherently incremental, so a TTL cache
//!    can't stand in for a ledger on disk.
//! 3. **The past is not immutable.** Steam recalculates old days as
//!    transactions settle late. `GetChangedDatesForPartner` hands back every
//!    date that moved since our cursor; we refetch those days *wholesale*,
//!    which is what makes a re-sync idempotent.
//!
//! The finest grain Valve offers is one day, in US Pacific time. There is no
//! hourly or per-transaction feed, so nothing here can be — or claims to be —
//! realtime. Tiles label the newest complete day by its own date rather than
//! calling it "today".

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Datelike, Days, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::http;

const BASE: &str = "https://partner.steam-api.com/IPartnerFinancialsService";
/// Daily data doesn't move faster than this, and the ledger survives restarts.
const SYNC_INTERVAL_SECS: u64 = 30 * 60;
/// A bound on the first sync of a long-lived title, and plain politeness to an
/// endpoint that bills one HTTP round trip per day of history.
const MAX_DATES_PER_SYNC: usize = 40;
/// Pagination guard: a day with more pages than this is a bug, not a good day.
const MAX_PAGES_PER_DATE: usize = 40;
/// How many days the tiles' sparkline covers.
const SPARK_DAYS: usize = 30;
/// Two years of daily rows keeps the ledger a few hundred KB; older days are
/// spent history that no tile asks for.
const KEEP_DAYS: usize = 730;

/* --------------------------------- secret ---------------------------------- */

/// The publisher key, in the OS credential store. Only this module reads it.
mod secret {
    const SERVICE: &str = "uwebbrowser";
    const ACCOUNT: &str = "steam-partner-financial-key";

    #[cfg(windows)]
    mod imp {
        use super::{ACCOUNT, SERVICE};
        use keyring::{Entry, Error};

        fn entry() -> Result<Entry, String> {
            Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
        }

        pub fn set(key: &str) -> Result<(), String> {
            entry()?.set_password(key).map_err(|e| e.to_string())
        }

        pub fn get() -> Result<Option<String>, String> {
            match entry()?.get_password() {
                Ok(key) => Ok(Some(key)),
                Err(Error::NoEntry) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }

        pub fn clear() -> Result<(), String> {
            match entry()?.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        }
    }

    // Everything else in the app degrades gracefully off Windows; a financial
    // key with nowhere safe to live must not degrade to a plaintext file.
    #[cfg(not(windows))]
    mod imp {
        const UNSUPPORTED: &str = "no OS credential store on this platform";

        pub fn set(_key: &str) -> Result<(), String> {
            Err(UNSUPPORTED.to_string())
        }
        pub fn get() -> Result<Option<String>, String> {
            Ok(None)
        }
        pub fn clear() -> Result<(), String> {
            Ok(())
        }
    }

    pub use imp::{clear, get, set};
}

/* ---------------------------------- store ---------------------------------- */

/// One app's totals for one Pacific day, folded down from the raw rows.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Day {
    gross_units: i64,
    net_units: i64,
    gross_usd: f64,
    /// Gross sales less returns and tax — still *before* Valve's split.
    net_usd: f64,
    returns_usd: f64,
    /// Net sales per ISO country code, for the "where it sold" line.
    countries: BTreeMap<String, f64>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Store {
    /// Cursor from `GetChangedDatesForPartner`; 0 means "never synced".
    highwatermark: u64,
    last_synced_at: u64,
    /// Pacific date (`YYYY-MM-DD`) -> app id -> that day's totals. A BTreeMap
    /// so the keys iterate chronologically, which every read below relies on.
    days: BTreeMap<String, BTreeMap<String, Day>>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("sales");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("steam.json"))
}

fn load(app: &AppHandle) -> Result<Store, String> {
    let path = store_path(app)?;
    // A ledger we can't parse is a ledger we resync from the cursor, not a
    // reason to leave the tile dead.
    Ok(fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default())
}

fn save(app: &AppHandle, store: &Store) -> Result<(), String> {
    let path = store_path(app)?;
    let body = serde_json::to_vec(store).map_err(|e| e.to_string())?;
    // Write-then-rename: a crash mid-write can't leave a truncated ledger.
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/* ----------------------------------- http ---------------------------------- */

/// reqwest prints the request URL in its `Display`, and ours carries the
/// publisher key. Never let that reach a log line, an error tile, or a
/// bug report.
fn scrub(e: impl std::fmt::Display) -> String {
    let text = e.to_string();
    match text.find("key=") {
        Some(at) => format!("{}key=<redacted>", &text[..at]),
        None => text,
    }
}

/// One `IPartnerFinancialsService` call. Unlike `api.steampowered.com`, the
/// partner host 403s every request that arrives without a publisher key.
async fn call(method: &str, params: &[(&str, String)]) -> Result<Value, String> {
    let key = secret::get()?.ok_or("Steamworks isn't connected")?;
    let client = http::shared()?;

    let mut query: Vec<(&str, String)> = vec![("key", key)];
    query.extend(params.iter().cloned());

    let response = client
        .get(format!("{BASE}/{method}/v001/"))
        .query(&query)
        .send()
        .await
        .map_err(scrub)?;

    let status = response.status();
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err("Steam rejected the key. It needs the Sales Data permission.".to_string());
    }
    if !status.is_success() {
        return Err(format!("Steam answered {status}"));
    }
    let body: Value = http::json_capped(response).await?;
    Ok(body["response"].clone())
}

/// Steam serialises 64-bit ids — and some money fields — as JSON strings.
/// Accept either shape rather than silently reading them as zero.
fn num(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

fn uint(value: &Value) -> u64 {
    let n = num(value);
    if n > 0.0 {
        n as u64
    } else {
        0
    }
}

/* ----------------------------------- sync ---------------------------------- */

static SYNCING: AtomicBool = AtomicBool::new(false);

/// `YYYY-MM-DD` from any of the three forms Steam accepts and echoes
/// (`2026-07-09`, `2026/07/09`, `20260709`). The dashed form is what the
/// ledger keys on, so it sorts chronologically as a string.
fn normalize_date(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    if digits.len() != 8 {
        return None;
    }
    let iso = format!("{}-{}-{}", &digits[0..4], &digits[4..6], &digits[6..8]);
    parse_day(&iso).map(|_| iso)
}

fn parse_day(iso: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").ok()
}

/// A changed-dates entry is a bare date string, or an object carrying one.
fn date_of(value: &Value) -> Option<String> {
    let raw = value.as_str().or_else(|| value["date"].as_str())?;
    normalize_date(raw)
}

/// One detailed-sales row into the day's per-app totals. Rows arrive split by
/// package, country and platform; we keep the app-level sums plus a per-country
/// slice and drop the rest — the raw grain runs to thousands of rows a day and
/// no tile ever asks for it.
///
/// The `*_usd` fields are read as whole dollars. Valve's docs don't say whether
/// they're dollars or cents, so check the first sync against the Steamworks
/// dashboard: if every figure reads 100× high, they're cents, and the fix is to
/// divide here — the one place they enter the ledger.
fn fold(totals: &mut BTreeMap<String, Day>, row: &Value) {
    let appid = uint(&row["appid"]);
    // Bundle and micro-transaction rows with no owning app; nothing to attribute.
    if appid == 0 {
        return;
    }
    let day = totals.entry(appid.to_string()).or_default();
    let net = num(&row["net_sales_usd"]);

    day.gross_units += num(&row["gross_units_sold"]) as i64;
    day.net_units += num(&row["net_units_sold"]) as i64;
    day.gross_usd += num(&row["gross_sales_usd"]);
    day.net_usd += net;
    day.returns_usd += num(&row["gross_returns_usd"]);

    if let Some(country) = row["country_code"].as_str() {
        *day.countries.entry(country.to_string()).or_default() += net;
    }
}

/// Every row for one date, paginated by `highwatermark_id`, folded to per-app
/// totals. An empty map means Steam has no sales on file for that date — which
/// is a real answer, and erases whatever we had stored for it.
async fn fetch_day(date: &str) -> Result<BTreeMap<String, Day>, String> {
    let mut totals: BTreeMap<String, Day> = BTreeMap::new();
    let mut cursor = 0u64;

    for _ in 0..MAX_PAGES_PER_DATE {
        let page = call(
            "GetDetailedSales",
            &[
                ("date", date.to_string()),
                ("highwatermark_id", cursor.to_string()),
            ],
        )
        .await?;

        let rows = page["results"]
            .as_array()
            .or_else(|| page["sales"].as_array())
            .cloned()
            .unwrap_or_default();
        if rows.is_empty() {
            break;
        }
        for row in &rows {
            fold(&mut totals, row);
        }

        let next = uint(&page["result_highwatermark_id"]);
        // A cursor that doesn't advance is the end of the date, not a loop.
        if next == 0 || next == cursor {
            break;
        }
        cursor = next;
    }

    Ok(totals)
}

fn prune(store: &mut Store) {
    while store.days.len() > KEEP_DAYS {
        let Some(oldest) = store.days.keys().next().cloned() else {
            break;
        };
        store.days.remove(&oldest);
    }
}

/// Pull every date Steam says changed since our cursor and rewrite those days.
/// Reentrant-safe: a second caller while one is in flight is a no-op.
async fn sync(app: &AppHandle) -> Result<(), String> {
    if SYNCING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = sync_inner(app).await;
    SYNCING.store(false, Ordering::SeqCst);
    result
}

async fn sync_inner(app: &AppHandle) -> Result<(), String> {
    let mut store = load(app)?;

    let changed = call(
        "GetChangedDatesForPartner",
        &[("highwatermark", store.highwatermark.to_string())],
    )
    .await?;

    let next_highwatermark = uint(&changed["result_highwatermark"]);
    let dates: Vec<String> = changed["dates"]
        .as_array()
        .map(|list| list.iter().filter_map(date_of).collect())
        .unwrap_or_default();

    for date in dates.iter().take(MAX_DATES_PER_SYNC) {
        let rows = fetch_day(date).await?;
        if rows.is_empty() {
            store.days.remove(date);
        } else {
            store.days.insert(date.clone(), rows);
        }
    }

    // Only advance the cursor once we've consumed every date Steam offered.
    // Advancing past a date we truncated would skip it forever.
    if dates.len() <= MAX_DATES_PER_SYNC && next_highwatermark > 0 {
        store.highwatermark = next_highwatermark;
    }
    store.last_synced_at = now();
    prune(&mut store);
    save(app, &store)
}

/* -------------------------------- summarize -------------------------------- */

fn day_json(date: NaiveDate, day: &Day) -> Value {
    json!({
        "date": date.to_string(),
        "netUsd": day.net_usd,
        "grossUsd": day.gross_usd,
        "units": day.net_units,
    })
}

/// The shape both tiles read. Windows are anchored on the newest day *we have*,
/// not on the wall clock: the caller's clock and Valve's Pacific ledger disagree
/// for hours every day, and a "today" that renders empty until noon is a lie
/// dressed as a zero.
fn summarize(store: &Store, appid: &str) -> Value {
    let mut series: Vec<(NaiveDate, &Day)> = store
        .days
        .iter()
        .filter_map(|(date, apps)| Some((parse_day(date)?, apps.get(appid)?)))
        .collect();
    series.sort_by_key(|(date, _)| *date);

    let base = json!({
        "connected": true,
        "lastSyncedAt": store.last_synced_at,
        "syncing": SYNCING.load(Ordering::SeqCst),
    });
    let Some((latest_date, latest)) = series.last().copied() else {
        return merge(base, json!({ "hasData": false }));
    };

    let window = |span: u64| -> Value {
        let from = latest_date.checked_sub_days(Days::new(span - 1));
        let (mut net, mut gross, mut units) = (0.0, 0.0, 0i64);
        for (date, day) in &series {
            if from.is_some_and(|start| *date >= start) {
                net += day.net_usd;
                gross += day.gross_usd;
                units += day.net_units;
            }
        }
        json!({ "netUsd": net, "grossUsd": gross, "units": units, "days": span })
    };

    let (mut mtd_net, mut mtd_gross, mut mtd_units) = (0.0, 0.0, 0i64);
    for (date, day) in &series {
        if date.year() == latest_date.year() && date.month() == latest_date.month() {
            mtd_net += day.net_usd;
            mtd_gross += day.gross_usd;
            mtd_units += day.net_units;
        }
    }

    let previous = latest_date
        .checked_sub_days(Days::new(1))
        .and_then(|target| series.iter().rev().find(|(date, _)| *date == target))
        .map(|(date, day)| day_json(*date, day));

    // Zero-filled so a quiet day reads as a trough rather than vanishing and
    // letting the trace draw a straight line over it.
    let spark: Vec<f64> = (0..SPARK_DAYS)
        .rev()
        .map(|back| {
            latest_date
                .checked_sub_days(Days::new(back as u64))
                .and_then(|date| series.iter().find(|(other, _)| *other == date))
                .map_or(0.0, |(_, day)| day.net_usd)
        })
        .collect();

    let mut by_country: BTreeMap<&str, f64> = BTreeMap::new();
    if let Some(from) = latest_date.checked_sub_days(Days::new(29)) {
        for (date, day) in &series {
            if *date >= from {
                for (code, net) in &day.countries {
                    *by_country.entry(code).or_default() += net;
                }
            }
        }
    }
    let top_country = by_country
        .into_iter()
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(code, net)| json!({ "code": code, "netUsd": net }));

    merge(
        base,
        json!({
            "hasData": true,
            "latest": day_json(latest_date, latest),
            "previous": previous,
            "last7": window(7),
            "last30": window(30),
            "monthToDate": {
                "netUsd": mtd_net, "grossUsd": mtd_gross, "units": mtd_units, "days": latest_date.day(),
            },
            "spark": spark,
            "topCountry": top_country,
        }),
    )
}

/// Shallow-merge `extra` over `base`; both are always objects here.
fn merge(mut base: Value, extra: Value) -> Value {
    if let (Some(target), Some(source)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    base
}

/* -------------------------------- commands --------------------------------- */

fn status(app: &AppHandle) -> Result<Value, String> {
    Ok(json!({
        "connected": secret::get()?.is_some(),
        "lastSyncedAt": load(app)?.last_synced_at,
        "syncing": SYNCING.load(Ordering::SeqCst),
    }))
}

/// Whether a key is on file, when we last synced — never the key itself.
#[tauri::command]
pub async fn steam_sales_status(app: AppHandle) -> Result<Value, String> {
    status(&app)
}

/// Store the publisher key and prove it works before claiming success. A typo'd
/// key would otherwise sit in the credential store failing every silent sync.
#[tauri::command]
pub async fn steam_sales_connect(app: AppHandle, key: String) -> Result<Value, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Paste your publisher Web API key first".to_string());
    }
    secret::set(key)?;
    if let Err(e) = call("GetChangedDatesForPartner", &[("highwatermark", "0".into())]).await {
        let _ = secret::clear();
        return Err(e);
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = sync(&handle).await;
    });
    status(&app)
}

/// Forget the key *and* the ledger it filled. Revenue history shouldn't outlive
/// the credential that authorised reading it.
#[tauri::command]
pub async fn steam_sales_disconnect(app: AppHandle) -> Result<Value, String> {
    secret::clear()?;
    if let Ok(path) = store_path(&app) {
        let _ = fs::remove_file(path);
    }
    status(&app)
}

/// One app's sales, from the on-disk ledger, refreshing it when it goes stale.
#[tauri::command]
pub async fn steam_sales_summary(app: AppHandle, appid: String) -> Result<Value, String> {
    let appid = appid.trim().to_string();
    if appid.is_empty() {
        return Err("no Steam App ID".to_string());
    }
    if secret::get()?.is_none() {
        return Ok(json!({
            "connected": false, "hasData": false, "lastSyncedAt": 0, "syncing": false,
        }));
    }

    let store = load(&app)?;
    let stale = now().saturating_sub(store.last_synced_at) >= SYNC_INTERVAL_SECS;

    // Cold ledger: block, so the first paint carries numbers instead of an
    // empty card that fills in a few seconds later. Warm ledger: refresh behind
    // the tile and serve what we already have.
    if stale && store.days.is_empty() {
        sync(&app).await?;
        return Ok(summarize(&load(&app)?, &appid));
    }
    if stale {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = sync(&handle).await;
        });
    }
    Ok(summarize(&store, &appid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_normalize_from_every_form_steam_uses() {
        assert_eq!(normalize_date("2026-07-09").as_deref(), Some("2026-07-09"));
        assert_eq!(normalize_date("2026/07/09").as_deref(), Some("2026-07-09"));
        assert_eq!(normalize_date("20260709").as_deref(), Some("2026-07-09"));
        assert_eq!(normalize_date("2026-13-09"), None);
        assert_eq!(normalize_date("nonsense"), None);
    }

    #[test]
    fn changed_dates_accept_bare_strings_and_objects() {
        assert_eq!(date_of(&json!("20260709")).as_deref(), Some("2026-07-09"));
        assert_eq!(
            date_of(&json!({ "date": "2026-07-09" })).as_deref(),
            Some("2026-07-09")
        );
        assert_eq!(date_of(&json!({ "nope": 1 })), None);
    }

    #[test]
    fn numbers_parse_whether_steam_quotes_them_or_not() {
        assert_eq!(num(&json!(12.5)), 12.5);
        assert_eq!(num(&json!("12.5")), 12.5);
        assert_eq!(uint(&json!("76561197960265728")), 76561197960265728);
        assert_eq!(uint(&json!(-3)), 0);
        assert_eq!(num(&json!(null)), 0.0);
    }

    #[test]
    fn rows_fold_into_per_app_totals_and_country_slices() {
        let mut totals = BTreeMap::new();
        for country in ["US", "US", "FR"] {
            fold(
                &mut totals,
                &json!({
                    "appid": 570, "country_code": country,
                    "gross_units_sold": 2, "net_units_sold": 1,
                    "gross_sales_usd": 20.0, "net_sales_usd": 10.0,
                    "gross_returns_usd": 5.0,
                }),
            );
        }
        // A row with no owning app must not invent one.
        fold(&mut totals, &json!({ "appid": 0, "net_sales_usd": 999.0 }));

        assert_eq!(totals.len(), 1);
        let day = &totals["570"];
        assert_eq!(day.net_units, 3);
        assert_eq!(day.net_usd, 30.0);
        assert_eq!(day.returns_usd, 15.0);
        assert_eq!(day.countries["US"], 20.0);
        assert_eq!(day.countries["FR"], 10.0);
    }

    fn ledger(days: &[(&str, f64)]) -> Store {
        let mut store = Store::default();
        for (date, net) in days {
            let day = Day {
                net_usd: *net,
                net_units: 1,
                ..Day::default()
            };
            store
                .days
                .insert((*date).to_string(), BTreeMap::from([("570".into(), day)]));
        }
        store
    }

    #[test]
    fn summary_anchors_its_windows_on_the_newest_day_we_have() {
        let store = ledger(&[
            ("2026-06-30", 5.0),  // previous month: out of month-to-date
            ("2026-07-01", 10.0), // 9 days back: inside 30, outside 7
            ("2026-07-08", 20.0), // yesterday
            ("2026-07-09", 30.0), // latest
        ]);
        let summary = summarize(&store, "570");

        assert_eq!(summary["latest"]["date"], "2026-07-09");
        assert_eq!(summary["latest"]["netUsd"], 30.0);
        assert_eq!(summary["previous"]["netUsd"], 20.0);
        assert_eq!(summary["last7"]["netUsd"], 50.0);
        assert_eq!(summary["last30"]["netUsd"], 65.0);
        assert_eq!(summary["monthToDate"]["netUsd"], 60.0);

        // Zero-filled, newest last, one slot per day of the window.
        let spark = summary["spark"].as_array().unwrap();
        assert_eq!(spark.len(), SPARK_DAYS);
        assert_eq!(spark[SPARK_DAYS - 1], 30.0);
        assert_eq!(spark[SPARK_DAYS - 2], 20.0);
        assert_eq!(spark[SPARK_DAYS - 3], 0.0);
    }

    #[test]
    fn a_gap_where_yesterday_should_be_leaves_previous_empty() {
        let summary = summarize(&ledger(&[("2026-07-01", 10.0), ("2026-07-09", 30.0)]), "570");
        assert_eq!(summary["previous"], Value::Null);
        assert_eq!(summary["last7"]["netUsd"], 30.0);
    }

    #[test]
    fn an_app_with_no_rows_reports_no_data_rather_than_zeroes() {
        let summary = summarize(&ledger(&[("2026-07-09", 30.0)]), "999");
        assert_eq!(summary["hasData"], false);
        assert_eq!(summary["connected"], true);
        assert_eq!(summary["latest"], Value::Null);
    }

    #[test]
    fn the_key_never_survives_an_error_message() {
        let raw = "error sending request for url (https://partner.steam-api.com/x/?key=SECRET&date=1)";
        let scrubbed = scrub(raw);
        assert!(!scrubbed.contains("SECRET"));
        assert!(scrubbed.ends_with("key=<redacted>"));
    }

    #[test]
    fn pruning_drops_the_oldest_days_first() {
        let mut store = Store::default();
        for i in 0..(KEEP_DAYS + 3) {
            store.days.insert(format!("{:08}", 20000101 + i), BTreeMap::new());
        }
        prune(&mut store);
        assert_eq!(store.days.len(), KEEP_DAYS);
        assert_eq!(store.days.keys().next().unwrap(), "20000104");
    }
}
