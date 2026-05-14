// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filter DSL parser for the PR list toolbar — same yryvu DSL grammar
//! as the GitHub / GitLab sides ([`super::super::github::dsl`],
//! [`super::super::gitlab::dsl`]), translated to Gitea's REST query
//! parameters.
//!
//! Gitea's `/api/v1/repos/{owner}/{repo}/pulls` endpoint accepts:
//!
//! | DSL                     | Gitea query param           |
//! |-------------------------|-----------------------------|
//! | `state:open`            | `state=open`                |
//! | `state:closed`          | `state=closed`              |
//! | `state:merged`          | `state=closed` (Gitea has no native `merged` filter; `closed` returns both closed + merged, frontend filters by `pr.merged_at` if needed) |
//! | `author:foo`            | `poster=foo` (Gitea calls the author "poster") |
//! | `assignee:foo`          | `assigned_by=foo`           |
//! | `label:bug` (multi)     | `labels=bug` (comma-joined when multiple) |
//! | `milestone:foo`         | `milestones=foo`            |
//! | `head:branch`           | `head=branch`               |
//! | `base:branch`           | `base=branch`               |
//! | freeform text           | `q=...` (title/body search) |
//!
//! Unknown DSL keys (e.g. GitHub-only `review:`/`status:`) collapse
//! to the `q` text-search param — same convention as the GitLab
//! adapter.

/// Structured filter set ready to inline into Gitea's REST query
/// string. `pub(super)` so only the search module embeds it.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct GiteaFilters {
    pub state: Option<String>,
    pub poster: Option<String>,
    pub assigned_by: Option<String>,
    pub labels: Vec<String>,
    pub milestone: Option<String>,
    pub head: Option<String>,
    pub base: Option<String>,
    pub q: Option<String>,
}

impl GiteaFilters {
    fn append_q(&mut self, term: &str) {
        match &mut self.q {
            Some(existing) => {
                existing.push(' ');
                existing.push_str(term);
            }
            None => self.q = Some(term.to_string()),
        }
    }
}

/// Parse yryvu's raw DSL text into [`GiteaFilters`]. Grammar mirrors
/// the GitHub / GitLab sides; mapping is provider-specific.
pub(super) fn parse_filters(dsl: &str) -> GiteaFilters {
    let mut out = GiteaFilters::default();
    for piece in shlex::Shlex::new(dsl) {
        if let Some((key, value)) = piece.split_once(':') {
            let k = key.trim().to_ascii_lowercase();
            let v = value.trim().to_string();
            if k.is_empty() || v.is_empty() {
                out.append_q(&piece);
                continue;
            }
            match k.as_str() {
                "state" => out.state = Some(map_state(&v)),
                "author" => out.poster = Some(v),
                "assignee" => out.assigned_by = Some(v),
                "label" => out.labels.push(v),
                "milestone" => out.milestone = Some(v),
                "head" => out.head = Some(v),
                "base" => out.base = Some(v),
                _ => out.append_q(&piece),
            }
        } else {
            out.append_q(&piece);
        }
    }
    out
}

/// Gitea accepts `open`, `closed`, `all`. `merged` collapses to
/// `closed` (Gitea returns merged PRs under closed; the frontend can
/// filter by `pr.state === "merged"` after projection if needed).
fn map_state(raw: &str) -> String {
    match raw.to_ascii_lowercase().as_str() {
        "open" | "opened" => "open".to_string(),
        "closed" | "merged" => "closed".to_string(),
        _ => "all".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_filters_empty_default() {
        let f = parse_filters("");
        assert_eq!(f, GiteaFilters::default());
    }

    #[test]
    fn parse_filters_author_assignee_map_to_gitea_terms() {
        let f = parse_filters("author:foo assignee:bar");
        assert_eq!(f.poster.as_deref(), Some("foo"));
        assert_eq!(f.assigned_by.as_deref(), Some("bar"));
    }

    #[test]
    fn parse_filters_multiple_labels_collect() {
        let f = parse_filters("label:bug label:backend");
        assert_eq!(f.labels, vec!["bug".to_string(), "backend".to_string()]);
    }

    #[test]
    fn parse_filters_state_open_stays_open() {
        assert_eq!(parse_filters("state:open").state.as_deref(), Some("open"));
        assert_eq!(parse_filters("state:opened").state.as_deref(), Some("open"));
    }

    #[test]
    fn parse_filters_state_merged_collapses_to_closed() {
        // Gitea's REST API has no `state=merged` — merged PRs sit
        // under `state=closed`. The frontend distinguishes by the
        // projected PullRequestState::Merged field.
        assert_eq!(
            parse_filters("state:merged").state.as_deref(),
            Some("closed")
        );
    }

    #[test]
    fn parse_filters_head_base() {
        let f = parse_filters("head:feat-x base:main");
        assert_eq!(f.head.as_deref(), Some("feat-x"));
        assert_eq!(f.base.as_deref(), Some("main"));
    }

    #[test]
    fn parse_filters_milestone_quoted() {
        let f = parse_filters("milestone:\"v1.0\"");
        assert_eq!(f.milestone.as_deref(), Some("v1.0"));
    }

    #[test]
    fn parse_filters_freeform_into_q() {
        let f = parse_filters("performance regression");
        assert_eq!(f.q.as_deref(), Some("performance regression"));
    }

    #[test]
    fn parse_filters_unknown_key_into_q() {
        // GitHub-only `review:approved` falls through to text search.
        let f = parse_filters("review:approved");
        assert_eq!(f.q.as_deref(), Some("review:approved"));
    }

    #[test]
    fn parse_filters_mixed() {
        let f = parse_filters("perf author:foo label:bug state:open");
        assert_eq!(f.poster.as_deref(), Some("foo"));
        assert_eq!(f.labels, vec!["bug".to_string()]);
        assert_eq!(f.state.as_deref(), Some("open"));
        assert_eq!(f.q.as_deref(), Some("perf"));
    }
}
