// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filtered Gitea / Forgejo pull-request search via REST. Uses the
//! same `/api/v1/repos/{owner}/{repo}/pulls` endpoint as
//! [`super::prs::list_prs`] but with extra query params derived from
//! yryvu's DSL by [`super::dsl::parse_filters`].
//!
//! No GraphQL — review/CI status stay `None` in wave 1, same as the
//! list path.

use std::fmt::Write;

use serde::Deserialize;

use crate::backend::BackendError;

use super::super::github::PullRequestSummary;
use super::api_base;
use super::dsl::{parse_filters, GiteaFilters};
use super::prs::{get, GiteaPull};

/// Search pull requests in `owner/repo` matching `dsl`. `dsl` is the
/// raw user-typed text — parsing happens internally via
/// [`super::dsl::parse_filters`].
pub async fn search_prs(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    dsl: &str,
) -> Result<Vec<PullRequestSummary>, BackendError> {
    let base = api_base(hostname)?;
    let filters = parse_filters(dsl);
    let url = build_search_url(&base, owner, repo, &filters);
    let resp = get(&url, token).await?;
    let raw: Vec<GiteaPull> = resp
        .json()
        .await
        .map_err(|e| super::super::http::decode_error("decoding /pulls search response", e))?;
    Ok(raw.into_iter().map(PullRequestSummary::from).collect())
}

fn build_search_url(base: &str, owner: &str, repo: &str, f: &GiteaFilters) -> String {
    let mut url = format!(
        "{base}/repos/{owner}/{repo}/pulls?limit=50&page=1&state={state}",
        state = f.state.as_deref().unwrap_or("all")
    );
    if let Some(v) = &f.poster {
        let _ = write!(url, "&poster={}", encode(v));
    }
    if let Some(v) = &f.assigned_by {
        let _ = write!(url, "&assigned_by={}", encode(v));
    }
    if !f.labels.is_empty() {
        let joined = f
            .labels
            .iter()
            .map(|l| encode(l))
            .collect::<Vec<_>>()
            .join(",");
        let _ = write!(url, "&labels={joined}");
    }
    if let Some(v) = &f.milestone {
        let _ = write!(url, "&milestones={}", encode(v));
    }
    if let Some(v) = &f.head {
        let _ = write!(url, "&head={}", encode(v));
    }
    if let Some(v) = &f.base {
        let _ = write!(url, "&base={}", encode(v));
    }
    if let Some(v) = &f.q {
        let _ = write!(url, "&q={}", encode(v));
    }
    url
}

/// Percent-encode for query-string values. Keep this in one place so
/// the encoded set stays consistent (alphanumerics + `-_.~` reserved
/// by RFC 3986 stay raw, everything else percent-escapes).
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                let _ = write!(out, "%{byte:02X}");
            }
        }
    }
    out
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GiteaSearchResp(Vec<GiteaPull>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_preserves_unreserved() {
        assert_eq!(encode("foo-bar.baz_qux~quux"), "foo-bar.baz_qux~quux");
    }

    #[test]
    fn encode_escapes_space() {
        assert_eq!(encode("foo bar"), "foo%20bar");
    }

    #[test]
    fn encode_escapes_quote() {
        assert_eq!(encode("foo\""), "foo%22");
    }

    #[test]
    fn build_url_default_filters() {
        let url = build_search_url(
            "https://codeberg.org/api/v1",
            "o",
            "r",
            &GiteaFilters::default(),
        );
        assert!(url.contains("/repos/o/r/pulls?"));
        assert!(url.contains("limit=50"));
        assert!(url.contains("state=all"));
        // No optional filter params when filters is empty.
        assert!(!url.contains("poster="));
        assert!(!url.contains("labels="));
    }

    #[test]
    fn build_url_with_author_state_labels() {
        let f = GiteaFilters {
            poster: Some("foo".to_string()),
            state: Some("open".to_string()),
            labels: vec!["bug".to_string(), "backend".to_string()],
            ..GiteaFilters::default()
        };
        let url = build_search_url("https://codeberg.org/api/v1", "o", "r", &f);
        assert!(url.contains("state=open"));
        assert!(url.contains("poster=foo"));
        assert!(url.contains("labels=bug,backend"));
    }

    #[test]
    fn build_url_escapes_q_with_spaces() {
        let f = GiteaFilters {
            q: Some("performance regression".to_string()),
            ..GiteaFilters::default()
        };
        let url = build_search_url("https://codeberg.org/api/v1", "o", "r", &f);
        assert!(url.contains("&q=performance%20regression"));
    }

    #[test]
    fn build_url_head_base_branches() {
        let f = GiteaFilters {
            head: Some("feat-x".to_string()),
            base: Some("main".to_string()),
            ..GiteaFilters::default()
        };
        let url = build_search_url("https://codeberg.org/api/v1", "o", "r", &f);
        assert!(url.contains("&head=feat-x"));
        assert!(url.contains("&base=main"));
    }
}
