//! Live checks against the real storefronts. Network-dependent, so ignored
//! by default; run with `cargo test --test discovery_live -- --ignored --nocapture`.

use uwebbrowser_lib::discovery::check_platform;

const PLATFORMS: &[&str] = &[
    "steam",
    "epic",
    "xbox",
    "playstation",
    "nintendo",
    "appstore",
    "googleplay",
    "itch",
    "twitch",
];

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(future)
}

#[test]
#[ignore]
fn hades_is_everywhere() {
    block_on(hades_is_everywhere_async());
}

async fn hades_is_everywhere_async() {
    let mut failures = Vec::new();
    for platform in PLATFORMS {
        match check_platform(platform.to_string(), "Hades".into()).await {
            Ok(hit) => {
                println!(
                    "{platform:12} found={} name={:?} url={:?}",
                    hit.found, hit.name, hit.url
                );
                // Hades is a launch-everywhere game, but on mobile it ships
                // through Netflix and doesn't always surface in the public
                // store searches; only the PC/console storefronts are a must.
                if !hit.found && !matches!(*platform, "googleplay" | "appstore") {
                    failures.push(format!("{platform}: not found"));
                }
                if hit.found {
                    let name = hit.name.as_deref().unwrap_or_default().to_lowercase();
                    if !name.starts_with("hades") {
                        failures.push(format!("{platform}: matched {name:?}"));
                    }
                    if hit.url.as_deref().unwrap_or_default().is_empty() {
                        failures.push(format!("{platform}: found but no url"));
                    }
                }
            }
            Err(e) => failures.push(format!("{platform}: {e}")),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
#[ignore]
fn nonsense_is_nowhere() {
    block_on(nonsense_is_nowhere_async());
}

async fn nonsense_is_nowhere_async() {
    for platform in ["steam", "epic", "twitch"] {
        let hit = check_platform(platform.to_string(), "zxqvwk nonexistent game 9137".into())
            .await
            .unwrap_or_default();
        println!("{platform:12} found={}", hit.found);
        assert!(!hit.found, "{platform} claims a hit for a nonsense name");
    }
}
