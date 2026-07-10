//! itch.io: the developer's games, and a revenue history we keep ourselves.
//!
//! itch.io's server API reports **cumulative lifetime earnings** per game — a
//! running total, never a time series. There is no endpoint that lists a game's
//! purchases: `/game/{id}/purchases` and `/game/{id}/download_keys` both demand
//! a buyer's email or user id up front, so they're lookups, not feeds. The sales
//! graph lives in the creator dashboard and nowhere else.
//!
//! So we build the history. Every time we actually reach itch (once per TTL
//! window, not once per poll) we snapshot the running total; the difference
//! between consecutive snapshots is what was earned in between, and it lands in
//! that day's bucket. That means:
//!
//! - History starts the day you connect. There is no backfill, and the widgets
//!   say so rather than implying the chart is complete.
//! - Days with the browser closed collapse into the next day we do observe.
//! - A refund shows up as a negative delta, which is correct, not a bug.
//!
//! Buckets are UTC calendar days. itch doesn't say what timezone its totals
//! roll over in, and inventing a local-time answer would be a guess wearing a
//! suit.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::cache::{get_or_fetch, TtlCache};
use crate::http::{self, get_json};
use crate::ledger;

static ITCH: LazyLock<TtlCache<Value>> = LazyLock::new(|| TtlCache::new(Duration::from_secs(300)));

/// How many daily buckets the sparkline covers.
const SPARK_DAYS: usize = 30;
/// Keep two years of buckets; the ledger stays a few KB.
const KEEP_DAYS: usize = 730;

/* ---------------------------------- ledger --------------------------------- */

/// Earnings per ISO currency code, in that currency's minor units (cents).
type Totals = BTreeMap<String, i64>;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Ledger {
    /// Fingerprint of the API key that filled this ledger. A different key is a
    /// different account, whose running total has nothing to do with ours — so
    /// the ledger resets rather than booking the difference as a day's revenue.
    key_fingerprint: String,
    /// Unix seconds of the first snapshot; what "tracking since" reports.
    started_at: u64,
    /// The last running total we saw, per currency. Deltas are measured off it.
    last_totals: Totals,
    /// UTC day (`YYYY-MM-DD`) -> currency -> minor units earned that day.
    days: BTreeMap<String, Totals>,
}

fn ledger_path(app: &AppHandle) -> Result<PathBuf, String> {
    ledger::path(app, "itch.json")
}

fn load(app: &AppHandle) -> Ledger {
    ledger_path(app)
        .as_ref()
        .map(ledger::load_or_default)
        .unwrap_or_default()
}

fn save(app: &AppHandle, ledger: &Ledger) -> Result<(), String> {
    ledger::save_atomic(&ledger_path(app)?, ledger)
}

fn now() -> u64 {
    ledger::now_secs()
}

/// The UTC calendar day containing `secs`.
fn day_of(secs: u64) -> String {
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .map(|dt| dt.date_naive().to_string())
        .unwrap_or_default()
}

/// Days before `day`, oldest first, ending on `day` itself.
fn window(day: &str, span: usize) -> Vec<String> {
    let Some(end) = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok() else {
        return Vec::new();
    };
    (0..span)
        .rev()
        .filter_map(|back| end.checked_sub_days(chrono::Days::new(back as u64)))
        .map(|date| date.to_string())
        .collect()
}

/// Which key filled this ledger, without keeping the key. Truncated because we
/// only ever compare it to itself.
fn fingerprint(api_key: &str) -> String {
    let digest = Sha256::digest(api_key.as_bytes());
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// itch quotes money as integer minor units, but has been known to send them as
/// JSON strings; accept either rather than silently reading zero.
fn cents(value: &Value) -> i64 {
    ledger::json_i64(value)
}

/// The account's running lifetime total, summed across games, per currency.
/// A game earning in two currencies contributes to both — they are never added
/// together, because 100 JPY is not 100 USD.
fn totals_of(games: &Value) -> Totals {
    let mut totals = Totals::new();
    for game in games.as_array().into_iter().flatten() {
        for earning in game["earnings"].as_array().into_iter().flatten() {
            let Some(currency) = earning["currency"].as_str() else {
                continue;
            };
            *totals.entry(currency.to_string()).or_default() += cents(&earning["amount"]);
        }
    }
    totals
}

fn prune(entries: &mut Ledger) {
    ledger::prune_oldest(&mut entries.days, KEEP_DAYS);
}

/// Fold one observation of the running total into the ledger.
fn record(ledger: &mut Ledger, totals: Totals, day: &str, at: u64, key_fingerprint: &str) {
    if ledger.key_fingerprint != key_fingerprint {
        *ledger = Ledger::default();
        ledger.key_fingerprint = key_fingerprint.to_string();
    }
    if ledger.started_at == 0 {
        ledger.started_at = at;
    }

    for (currency, total) in &totals {
        // A currency we've never seen gets baselined, not booked: its lifetime
        // total is history we didn't witness, and dumping it into today would
        // read as one spectacular afternoon.
        let Some(previous) = ledger.last_totals.get(currency) else {
            continue;
        };
        let delta = total - previous;
        if delta != 0 {
            *ledger
                .days
                .entry(day.to_string())
                .or_default()
                .entry(currency.clone())
                .or_default() += delta;
        }
    }

    ledger.last_totals = totals;
    prune(ledger);
}

/* ----------------------------------- fetch --------------------------------- */

/// The developer's games. Cached for 5 minutes; each real fetch is also the
/// snapshot that advances the revenue ledger.
async fn games(app: &AppHandle, api_key: String) -> Result<Value, String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("missing itch.io API key".into());
    }
    let key = api_key.clone();
    let handle = app.clone();

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

        let games = response["games"].clone();

        // Snapshot before returning. Best-effort: an unwritable ledger costs us
        // a data point, not the widget.
        let at = now();
        let mut ledger = load(&handle);
        record(&mut ledger, totals_of(&games), &day_of(at), at, &fingerprint(&api_key));
        let _ = save(&handle, &ledger);

        Ok(games)
    })
    .await
}

/* --------------------------------- commands -------------------------------- */

/// The developer's games on itch.io, with views/downloads/purchases and the
/// cumulative `earnings` array. Needs an itch.io API key (Settings → API keys).
#[tauri::command]
pub async fn itch_games(app: AppHandle, api_key: String) -> Result<Value, String> {
    games(&app, api_key).await
}

/// Lifetime earnings straight from itch, plus the day/week/month history we've
/// measured ourselves. Reports in the account's dominant currency — the one it
/// has earned the most in — and says how many others exist.
#[tauri::command]
pub async fn itch_earnings(app: AppHandle, api_key: String) -> Result<Value, String> {
    let live = games(&app, api_key).await?;
    let totals = totals_of(&live);
    let ledger = load(&app);

    let Some((currency, lifetime)) = totals
        .iter()
        .max_by_key(|(_, amount)| **amount)
        .map(|(currency, amount)| (currency.clone(), *amount))
    else {
        return Ok(json!({
            "hasData": false,
            "trackingSince": ledger.started_at,
            "currencies": 0,
        }));
    };

    let today = day_of(now());
    let earned = |day: &String| -> i64 {
        ledger
            .days
            .get(day)
            .and_then(|by_currency| by_currency.get(&currency))
            .copied()
            .unwrap_or(0)
    };
    let sum = |span: usize| -> i64 { window(&today, span).iter().map(earned).sum() };

    // Zero-filled, oldest first: a day with no sales is a trough, not a gap.
    let spark: Vec<i64> = window(&today, SPARK_DAYS).iter().map(earned).collect();

    Ok(json!({
        "hasData": true,
        "currency": currency,
        "currencies": totals.len(),
        "lifetimeCents": lifetime,
        "todayCents": sum(1),
        "last7Cents": sum(7),
        "last30Cents": sum(30),
        "spark": spark,
        "trackingSince": ledger.started_at,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(earnings: Value) -> Value {
        json!({ "title": "A game", "earnings": earnings })
    }

    #[test]
    fn totals_sum_per_currency_and_never_across_them() {
        let games = json!([
            game(json!([{ "currency": "USD", "amount": 5047 }])),
            game(json!([
                { "currency": "USD", "amount": 1000 },
                { "currency": "EUR", "amount": 250 },
            ])),
            game(json!([])),
        ]);
        let totals = totals_of(&games);
        assert_eq!(totals["USD"], 6047);
        assert_eq!(totals["EUR"], 250);
        assert_eq!(totals.len(), 2);
    }

    #[test]
    fn amounts_parse_whether_itch_quotes_them_or_not() {
        assert_eq!(cents(&json!(5047)), 5047);
        assert_eq!(cents(&json!("5047")), 5047);
        assert_eq!(cents(&json!(null)), 0);
    }

    #[test]
    fn the_first_snapshot_is_a_baseline_not_a_days_revenue() {
        let mut ledger = Ledger::default();
        record(&mut ledger, Totals::from([("USD".into(), 5000)]), "2026-07-10", 100, "fp");

        // A lifetime total we didn't witness must not land in today's bucket.
        assert!(ledger.days.is_empty());
        assert_eq!(ledger.last_totals["USD"], 5000);
        assert_eq!(ledger.started_at, 100);
    }

    #[test]
    fn the_delta_between_snapshots_is_the_days_revenue() {
        let mut ledger = Ledger::default();
        record(&mut ledger, Totals::from([("USD".into(), 5000)]), "2026-07-10", 100, "fp");
        record(&mut ledger, Totals::from([("USD".into(), 5300)]), "2026-07-10", 200, "fp");
        record(&mut ledger, Totals::from([("USD".into(), 5500)]), "2026-07-10", 300, "fp");
        record(&mut ledger, Totals::from([("USD".into(), 6000)]), "2026-07-11", 400, "fp");

        assert_eq!(ledger.days["2026-07-10"]["USD"], 500);
        assert_eq!(ledger.days["2026-07-11"]["USD"], 500);
        assert_eq!(ledger.last_totals["USD"], 6000);
    }

    #[test]
    fn a_refund_books_a_negative_day_rather_than_vanishing() {
        let mut ledger = Ledger::default();
        record(&mut ledger, Totals::from([("USD".into(), 5000)]), "2026-07-10", 100, "fp");
        record(&mut ledger, Totals::from([("USD".into(), 4800)]), "2026-07-10", 200, "fp");
        assert_eq!(ledger.days["2026-07-10"]["USD"], -200);
    }

    #[test]
    fn a_new_currency_is_baselined_not_booked_as_one_spectacular_day() {
        let mut ledger = Ledger::default();
        record(&mut ledger, Totals::from([("USD".into(), 5000)]), "2026-07-10", 100, "fp");
        record(
            &mut ledger,
            Totals::from([("USD".into(), 5000), ("EUR".into(), 9999)]),
            "2026-07-10",
            200,
            "fp",
        );
        assert!(ledger.days.get("2026-07-10").is_none());
        assert_eq!(ledger.last_totals["EUR"], 9999);

        // ...and from the next observation on, it accrues normally.
        record(
            &mut ledger,
            Totals::from([("USD".into(), 5000), ("EUR".into(), 10099)]),
            "2026-07-11",
            300,
            "fp",
        );
        assert_eq!(ledger.days["2026-07-11"]["EUR"], 100);
    }

    #[test]
    fn a_different_api_key_resets_the_ledger_instead_of_booking_the_difference() {
        let mut ledger = Ledger::default();
        record(&mut ledger, Totals::from([("USD".into(), 5000)]), "2026-07-10", 100, "one");
        record(&mut ledger, Totals::from([("USD".into(), 5500)]), "2026-07-10", 200, "one");
        assert_eq!(ledger.days["2026-07-10"]["USD"], 500);

        // Another account's running total is not this account's revenue.
        record(&mut ledger, Totals::from([("USD".into(), 90000)]), "2026-07-11", 300, "two");
        assert!(ledger.days.is_empty());
        assert_eq!(ledger.started_at, 300);
        assert_eq!(ledger.key_fingerprint, "two");
    }

    #[test]
    fn a_closed_browser_collapses_its_days_into_the_next_one_observed() {
        let mut ledger = Ledger::default();
        record(&mut ledger, Totals::from([("USD".into(), 100)]), "2026-07-01", 100, "fp");
        // Nothing observed for a week; the whole week's earnings land on the day
        // we next look. Documented behaviour, asserted so it stays deliberate.
        record(&mut ledger, Totals::from([("USD".into(), 800)]), "2026-07-08", 200, "fp");
        assert_eq!(ledger.days["2026-07-08"]["USD"], 700);
        assert_eq!(ledger.days.len(), 1);
    }

    #[test]
    fn windows_end_on_the_named_day_and_run_oldest_first() {
        assert_eq!(window("2026-07-10", 1), vec!["2026-07-10"]);
        assert_eq!(
            window("2026-07-10", 3),
            vec!["2026-07-08", "2026-07-09", "2026-07-10"]
        );
        assert_eq!(window("2026-07-10", SPARK_DAYS).len(), SPARK_DAYS);
        assert!(window("nonsense", 7).is_empty());
    }

    #[test]
    fn days_come_from_the_epoch_in_utc() {
        assert_eq!(day_of(0), "1970-01-01");
        assert_eq!(day_of(1_752_105_600), "2025-07-10");
    }

    #[test]
    fn the_fingerprint_is_stable_and_key_specific() {
        assert_eq!(fingerprint("abc"), fingerprint("abc"));
        assert_ne!(fingerprint("abc"), fingerprint("abd"));
        assert!(!fingerprint("abc").contains("abc"));
    }

    #[test]
    fn pruning_drops_the_oldest_buckets_first() {
        let mut ledger = Ledger::default();
        for i in 0..(KEEP_DAYS + 2) {
            ledger.days.insert(format!("{:08}", 20000101 + i), Totals::new());
        }
        prune(&mut ledger);
        assert_eq!(ledger.days.len(), KEEP_DAYS);
        assert_eq!(ledger.days.keys().next().unwrap(), "20000103");
    }
}
