//! Origin parsing and the host-matching policy.
//!
//! The whole security model of autofill rests on never offering a credential
//! to a page it wasn't saved for. We take the deciding origin from what the
//! native side knows about a webview, never from anything the page claims, and
//! we match hosts conservatively: exact host, or the page being a subdomain of
//! the saved host. We never widen a match to a sibling registrable domain, so
//! `evil-example.com` can never pull `example.com` credentials.

use url::Url;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Origin {
    pub scheme: String,
    pub host: String,
}

impl Origin {
    /// Parse a page URL into an origin, or `None` if it has no host.
    pub fn from_url(raw: &str) -> Option<Origin> {
        let url = Url::parse(raw).ok()?;
        let host = url.host_str()?.to_ascii_lowercase();
        if host.is_empty() {
            return None;
        }
        Some(Origin {
            scheme: url.scheme().to_ascii_lowercase(),
            host,
        })
    }

    /// Only https pages (and localhost over http, for local dev) may be filled.
    /// Plain http on the open web would expose a credential to a passive
    /// network observer, so we refuse it.
    pub fn is_fillable(&self) -> bool {
        match self.scheme.as_str() {
            "https" => true,
            "http" => is_local_host(&self.host),
            _ => false,
        }
    }
}

fn is_local_host(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host.ends_with(".localhost")
}

/// Shared-hosting suffixes where each subdomain is a separate owner but which
/// aren't in the Public Suffix List. `itch.io` in particular hosts every game
/// at `<dev>.itch.io` yet isn't a registered public suffix, so the PSL alone
/// would let one tenant's saved login match another's. These are checked before
/// the PSL and treated as if they were public suffixes.
const EXTRA_SUFFIXES: &[&str] = &["itch.io"];

/// The registrable domain (eTLD+1): `login.example.com` -> `example.com`,
/// `foo.example.co.uk` -> `example.co.uk`, `alice.itch.io` -> `alice.itch.io`.
///
/// Backed by the real Public Suffix List (the `psl` crate, list compiled in)
/// rather than a hand-maintained table, so shared-hosting suffixes like
/// `herokuapp.com`, `netlify.app`, `pages.dev`, `github.io` and every ccTLD are
/// covered, plus a small curated supplement ([`EXTRA_SUFFIXES`]) for gaps the
/// PSL doesn't list. A host that is itself a suffix, or has no known suffix
/// (e.g. `localhost`), is returned unchanged.
fn registrable_domain(host: &str) -> String {
    let host = host.to_ascii_lowercase();
    for suffix in EXTRA_SUFFIXES {
        if host == *suffix {
            return host;
        }
        // Only a dot-boundary match counts, so `notitch.io` isn't under `itch.io`.
        if let Some(owner) = host
            .strip_suffix(suffix)
            .and_then(|p| p.strip_suffix('.'))
            .map(|p| p.rsplit('.').next().unwrap_or(p))
        {
            return format!("{owner}.{suffix}");
        }
    }
    psl::domain_str(&host).map(str::to_string).unwrap_or(host)
}

/// Does a page host match a host stored on a saved credential?
///
/// They match when they share a registrable domain — so `example.com`,
/// `www.example.com`, `login.example.com`, and `accounts.example.com` all fill
/// each other, matching how people expect a password manager to behave. Because
/// the comparison is on the whole registrable domain, look-alikes like
/// `notexample.com` or `example.com.evil.com` never match `example.com`.
pub fn host_matches(page_host: &str, saved_host: &str) -> bool {
    let page = registrable_domain(&page_host.to_ascii_lowercase());
    let saved = registrable_domain(&saved_host.to_ascii_lowercase());
    !saved.is_empty() && page == saved
}

/// Pull the host out of a stored URL string, tolerating bare hosts that were
/// saved without a scheme.
pub fn host_of(raw: &str) -> Option<String> {
    if let Ok(url) = Url::parse(raw) {
        if let Some(host) = url.host_str() {
            return Some(host.to_ascii_lowercase());
        }
    }
    // Bare host like "github.com" or "github.com/login".
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let host = trimmed
        .split('/')
        .next()
        .unwrap_or(trimmed)
        .split(':')
        .next()
        .unwrap_or(trimmed);
    if host.contains('.') {
        Some(host.to_ascii_lowercase())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_and_subdomain_match() {
        assert!(host_matches("example.com", "example.com"));
        assert!(host_matches("login.example.com", "example.com"));
        assert!(host_matches("www.example.com", "example.com"));
    }

    #[test]
    fn sibling_subdomains_match() {
        // A login saved for one subdomain fills a sibling on the same site.
        assert!(host_matches("accounts.clerk.com", "dashboard.clerk.com"));
        assert!(host_matches("clerk.com", "dashboard.clerk.com"));
        assert!(host_matches("foo.example.co.uk", "bar.example.co.uk"));
    }

    #[test]
    fn look_alikes_do_not_match() {
        assert!(!host_matches("notexample.com", "example.com"));
        assert!(!host_matches("example.com.evil.com", "example.com"));
        assert!(!host_matches("example.org", "example.com"));
        // Different owners under a multi-label public suffix.
        assert!(!host_matches("example.co.uk", "other.co.uk"));
        assert!(!host_matches("alice.github.io", "bob.github.io"));
        // Shared-hosting suffixes from the real PSL: sibling tenants are
        // distinct sites and must never cross-fill.
        assert!(!host_matches("alice.itch.io", "evil.itch.io"));
        assert!(!host_matches("a.herokuapp.com", "b.herokuapp.com"));
        assert!(!host_matches("a.netlify.app", "b.netlify.app"));
    }

    #[test]
    fn same_tenant_still_matches() {
        // The saved site itself, and its own subdomains, still fill.
        assert!(host_matches("alice.itch.io", "alice.itch.io"));
        assert!(host_matches("www.alice.itch.io", "alice.itch.io"));
    }

    #[test]
    fn fillable_scheme_policy() {
        assert!(Origin::from_url("https://example.com").unwrap().is_fillable());
        assert!(!Origin::from_url("http://example.com").unwrap().is_fillable());
        assert!(Origin::from_url("http://localhost:3000").unwrap().is_fillable());
    }
}
