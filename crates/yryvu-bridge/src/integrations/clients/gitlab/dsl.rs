// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filter DSL parser for the PR list toolbar — same yryvu DSL grammar
//! as the GitHub side ([`super::super::github::dsl`]), translated to
//! GitLab's GraphQL `mergeRequests` filter arguments.
//!
//! GitLab's filter shape is STRUCTURED — every argument has a typed
//! GraphQL parameter (`authorUsername`, `assigneeUsername`, etc),
//! unlike GitHub's free-form search query string. Anything that
//! doesn't match a known DSL key collapses into the `search` arg
//! (title/description text search), the closest GitLab analog to
//! GitHub's freeform terms.

/// Structured filter set ready to inline into a GitLab GraphQL
/// `mergeRequests(...)` call. `pub(super)` because only the search
/// module embeds it into a query — callers go through
/// [`super::search::search_mrs`].
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct GitlabFilters {
    pub state: Option<String>,
    pub author_username: Option<String>,
    pub assignee_username: Option<String>,
    pub reviewer_username: Option<String>,
    pub labels: Vec<String>,
    pub milestone_title: Option<String>,
    pub draft: Option<bool>,
    pub source_branches: Vec<String>,
    pub target_branches: Vec<String>,
    pub search: Option<String>,
}

impl GitlabFilters {
    fn append_search(&mut self, term: &str) {
        match &mut self.search {
            Some(existing) => {
                existing.push(' ');
                existing.push_str(term);
            }
            None => self.search = Some(term.to_string()),
        }
    }
}

/// Parse yryvu's raw DSL text into [`GitlabFilters`]. Tokens follow
/// the same grammar as the GitHub side — see
/// [`super::super::github::dsl`]. Unknown keys (e.g. GitHub-only
/// `review:`/`status:`) and bare terms collapse into the `search` arg.
pub(super) fn parse_filters(dsl: &str) -> GitlabFilters {
    let mut out = GitlabFilters::default();
    for piece in shlex::Shlex::new(dsl) {
        if let Some((key, value)) = piece.split_once(':') {
            let k = key.trim().to_ascii_lowercase();
            let v = value.trim().to_string();
            if k.is_empty() || v.is_empty() {
                out.append_search(&piece);
                continue;
            }
            match k.as_str() {
                "author" => out.author_username = Some(v),
                "assignee" => out.assignee_username = Some(v),
                "reviewer" => out.reviewer_username = Some(v),
                "label" => out.labels.push(v),
                "milestone" => out.milestone_title = Some(v),
                "state" => out.state = Some(map_state(&v)),
                "draft" => out.draft = v.parse().ok(),
                "base" => out.target_branches.push(v),
                "head" => out.source_branches.push(v),
                // Unknown keys collapse to search — handles GitHub-only
                // tokens like `review:` / `status:` gracefully.
                _ => out.append_search(&piece),
            }
        } else {
            out.append_search(&piece);
        }
    }
    out
}

/// Map yryvu's DSL state vocabulary to GitLab's `state` arg. yryvu
/// canonicalises on GitHub-style `open` while GitLab uses `opened`;
/// we accept both so power users typing the DSL directly can use
/// either.
fn map_state(raw: &str) -> String {
    match raw.to_ascii_lowercase().as_str() {
        "open" | "opened" => "opened".to_string(),
        "closed" => "closed".to_string(),
        "merged" => "merged".to_string(),
        _ => "all".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_filters_empty_yields_default() {
        let f = parse_filters("");
        assert_eq!(f, GitlabFilters::default());
    }

    #[test]
    fn parse_filters_author_assignee() {
        let f = parse_filters("author:foo assignee:bar");
        assert_eq!(f.author_username.as_deref(), Some("foo"));
        assert_eq!(f.assignee_username.as_deref(), Some("bar"));
    }

    #[test]
    fn parse_filters_multiple_labels_collect() {
        let f = parse_filters("label:bug label:backend");
        assert_eq!(f.labels, vec!["bug".to_string(), "backend".to_string()]);
    }

    #[test]
    fn parse_filters_state_map_open_to_opened() {
        let f = parse_filters("state:open");
        assert_eq!(f.state.as_deref(), Some("opened"));
    }

    #[test]
    fn parse_filters_state_map_already_opened_passthrough() {
        let f = parse_filters("state:opened");
        assert_eq!(f.state.as_deref(), Some("opened"));
    }

    #[test]
    fn parse_filters_draft_bool() {
        let f = parse_filters("draft:true");
        assert_eq!(f.draft, Some(true));
        let f = parse_filters("draft:false");
        assert_eq!(f.draft, Some(false));
        let f = parse_filters("draft:maybe");
        assert_eq!(f.draft, None);
    }

    #[test]
    fn parse_filters_base_head() {
        let f = parse_filters("base:main head:feat-x");
        assert_eq!(f.target_branches, vec!["main".to_string()]);
        assert_eq!(f.source_branches, vec!["feat-x".to_string()]);
    }

    #[test]
    fn parse_filters_milestone_quoted() {
        let f = parse_filters("milestone:\"v1.0\"");
        assert_eq!(f.milestone_title.as_deref(), Some("v1.0"));
    }

    #[test]
    fn parse_filters_freeform_into_search() {
        let f = parse_filters("performance regression");
        assert_eq!(f.search.as_deref(), Some("performance regression"));
    }

    #[test]
    fn parse_filters_unknown_key_into_search() {
        // GitHub-only tokens like `review:approved` shouldn't be lost —
        // pass them through to GitLab's text search so the user still
        // gets some matching behaviour.
        let f = parse_filters("review:approved");
        assert_eq!(f.search.as_deref(), Some("review:approved"));
    }

    #[test]
    fn parse_filters_mixed() {
        let f = parse_filters("perf author:foo label:bug state:open");
        assert_eq!(f.author_username.as_deref(), Some("foo"));
        assert_eq!(f.labels, vec!["bug".to_string()]);
        assert_eq!(f.state.as_deref(), Some("opened"));
        assert_eq!(f.search.as_deref(), Some("perf"));
    }
}
