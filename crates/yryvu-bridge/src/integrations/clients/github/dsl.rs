// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filter DSL parser for the PR list toolbar. Mirrors GitKraken's
//! `PullRequestFilter-Syntax*` token grammar (audited via
//! `app/src/strings/en-us.json`) and translates to GitHub's
//! search/issues query syntax.
//!
//! Token grammar (DSL → GitHub search):
//!
//! | DSL                      | GitHub search                 |
//! |--------------------------|-------------------------------|
//! | `author:foo`             | `author:foo`                  |
//! | `assignee:foo`           | `assignee:foo`                |
//! | `involves:foo`           | `involves:foo`                |
//! | `base:branch`            | `base:branch`                 |
//! | `head:branch`            | `head:branch`                 |
//! | `label:"name"`           | `label:"name"`                |
//! | `milestone:"name"`       | `milestone:"name"`            |
//! | `state:open`             | `is:open`                     |
//! | `state:closed`           | `is:closed`                   |
//! | `state:merged`           | `is:merged`                   |
//! | `draft:true`             | `draft:true`                  |
//! | `review:approved`        | `review:approved`             |
//! | `status:success`         | `status:success`              |
//! | `created:2026-05-14`     | `created:2026-05-14`          |
//! | `updated:>=2026-05-14`   | `updated:>=2026-05-14`        |
//! | freeform text            | bare term (title/body search) |
//!
//! Quoted strings with spaces are preserved (e.g.
//! `label:"good first issue"`). Unknown DSL keys collapse to
//! freeform — the user might be experimenting with future tokens,
//! we'd rather forward them than reject the query.

use std::fmt::Write;

/// A single parsed DSL token. Public so the toolbar component can
/// reconstruct the textual query from its dropdown state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DslToken {
    /// `key:value` pair. `key` is normalised (lowercase, trimmed).
    /// `value` keeps the user's casing because GitHub search is
    /// case-sensitive for label names and case-insensitive for users.
    KeyValue { key: String, value: String },
    /// Bare term — title/body keyword.
    Freeform(String),
}

/// Tokenise the user's raw query into [`DslToken`]s. Quoted strings
/// keep spaces; everything else splits on whitespace. Unparseable
/// input (unbalanced quotes) collapses to a single freeform token —
/// we never want to leak a parse error to the user; GitHub will
/// reject what it doesn't understand.
pub fn tokenise(raw: &str) -> Vec<DslToken> {
    let pieces: Vec<String> = shlex::Shlex::new(raw).collect();
    if pieces.is_empty() {
        return Vec::new();
    }
    pieces
        .into_iter()
        .map(|piece| match piece.split_once(':') {
            Some((key, value)) if !key.is_empty() && !value.is_empty() => DslToken::KeyValue {
                key: key.trim().to_ascii_lowercase(),
                value: value.trim().to_string(),
            },
            _ => DslToken::Freeform(piece),
        })
        .collect()
}

/// Compose a GitHub search/issues query string for `owner/repo` from
/// the user's DSL. Always prepends `is:pr repo:owner/name` so the
/// search stays scoped to the active repository.
///
/// The result is the raw `q=` value; the caller URL-encodes it.
pub fn to_github_search(owner: &str, repo: &str, dsl: &str) -> String {
    let mut q = format!("is:pr repo:{owner}/{repo}");
    for token in tokenise(dsl) {
        match token {
            DslToken::KeyValue { key, value } => {
                let mapped = map_kv(&key, &value);
                let _ = write!(q, " {mapped}");
            }
            DslToken::Freeform(term) => {
                let quoted = needs_quoting(&term);
                if quoted {
                    let _ = write!(q, " \"{term}\"");
                } else {
                    let _ = write!(q, " {term}");
                }
            }
        }
    }
    q
}

/// Map one `key:value` token to GitHub search syntax. Unknown keys
/// pass through verbatim (so future GitHub search additions don't
/// need a yryvu update to work).
fn map_kv(key: &str, value: &str) -> String {
    // `state:` is the only key whose mapping changes the syntax
    // shape (`state:open` → `is:open`). The rest are 1:1.
    if key == "state" {
        let v = value.to_ascii_lowercase();
        if matches!(v.as_str(), "open" | "closed" | "merged") {
            return format!("is:{v}");
        }
    }
    let needs_quote = needs_quoting(value);
    if needs_quote {
        format!("{key}:\"{value}\"")
    } else {
        format!("{key}:{value}")
    }
}

fn needs_quoting(s: &str) -> bool {
    s.chars().any(|c| c.is_whitespace())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kv(k: &str, v: &str) -> DslToken {
        DslToken::KeyValue {
            key: k.to_string(),
            value: v.to_string(),
        }
    }

    fn free(s: &str) -> DslToken {
        DslToken::Freeform(s.to_string())
    }

    #[test]
    fn tokenise_empty_returns_empty() {
        assert!(tokenise("").is_empty());
        assert!(tokenise("   ").is_empty());
    }

    #[test]
    fn tokenise_single_freeform() {
        assert_eq!(tokenise("hello"), vec![free("hello")]);
    }

    #[test]
    fn tokenise_single_kv() {
        assert_eq!(tokenise("author:foo"), vec![kv("author", "foo")]);
    }

    #[test]
    fn tokenise_mixed_kv_and_freeform() {
        assert_eq!(
            tokenise("bug author:foo state:open"),
            vec![
                free("bug"),
                kv("author", "foo"),
                kv("state", "open"),
            ]
        );
    }

    #[test]
    fn tokenise_quoted_label_keeps_spaces() {
        // `label:"good first issue"` → kv(label, good first issue).
        // shlex strips the quotes after honouring them as a single
        // word.
        assert_eq!(
            tokenise("label:\"good first issue\""),
            vec![kv("label", "good first issue")]
        );
    }

    #[test]
    fn tokenise_key_normalised_lowercase() {
        assert_eq!(tokenise("Author:foo"), vec![kv("author", "foo")]);
    }

    #[test]
    fn tokenise_unbalanced_quotes_returns_empty() {
        // shlex returns nothing for unbalanced input; we surface that
        // as an empty token list rather than failing the search.
        assert!(tokenise("label:\"unbalanced").is_empty());
    }

    #[test]
    fn to_github_search_no_dsl_yields_scope_only() {
        assert_eq!(
            to_github_search("owner", "repo", ""),
            "is:pr repo:owner/repo"
        );
    }

    #[test]
    fn to_github_search_translates_state_to_is() {
        assert_eq!(
            to_github_search("owner", "repo", "state:open"),
            "is:pr repo:owner/repo is:open"
        );
        assert_eq!(
            to_github_search("owner", "repo", "state:merged"),
            "is:pr repo:owner/repo is:merged"
        );
        assert_eq!(
            to_github_search("owner", "repo", "state:closed"),
            "is:pr repo:owner/repo is:closed"
        );
    }

    #[test]
    fn to_github_search_unknown_state_falls_through() {
        // `state:garbage` isn't open/closed/merged so we leave the
        // pair as-is — GitHub will reject it but we don't pretend
        // to know better than the user.
        assert_eq!(
            to_github_search("owner", "repo", "state:garbage"),
            "is:pr repo:owner/repo state:garbage"
        );
    }

    #[test]
    fn to_github_search_passes_through_known_keys() {
        assert_eq!(
            to_github_search("o", "r", "author:foo assignee:bar label:bug"),
            "is:pr repo:o/r author:foo assignee:bar label:bug"
        );
    }

    #[test]
    fn to_github_search_quotes_label_with_spaces() {
        assert_eq!(
            to_github_search("o", "r", "label:\"good first issue\""),
            "is:pr repo:o/r label:\"good first issue\""
        );
    }

    #[test]
    fn to_github_search_passes_unknown_keys_through() {
        // `frobnicate:42` isn't a known DSL key but we forward it —
        // letting future GitHub search syntax work without a yryvu
        // bump.
        assert_eq!(
            to_github_search("o", "r", "frobnicate:42"),
            "is:pr repo:o/r frobnicate:42"
        );
    }

    #[test]
    fn to_github_search_includes_freeform_terms() {
        assert_eq!(
            to_github_search("o", "r", "panel author:lobinuxsoft"),
            "is:pr repo:o/r panel author:lobinuxsoft"
        );
    }

    #[test]
    fn to_github_search_review_and_status_tokens() {
        assert_eq!(
            to_github_search("o", "r", "review:approved status:success"),
            "is:pr repo:o/r review:approved status:success"
        );
    }

    #[test]
    fn to_github_search_date_range_passes_through() {
        assert_eq!(
            to_github_search("o", "r", "created:>=2026-05-01"),
            "is:pr repo:o/r created:>=2026-05-01"
        );
    }
}
