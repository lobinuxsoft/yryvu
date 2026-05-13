// SPDX-License-Identifier: AGPL-3.0-or-later

//! Best-effort hosting-service detection from the repo's remotes.
//!
//! Drives provider-aware avatar resolution in the graph — notably the
//! GitHub CDN endpoint `https://avatars.githubusercontent.com/u/e?email=…`
//! (bundle offset 1508073 in `@gitkraken/gitkraken-components`'s app
//! bundle) which resolves an avatar from an email with no API auth and
//! no per-user lookup.

use std::path::Path;

use super::common::open_repo;

/// The canonical upstream hosting platforms Yryvu recognises. Unknown
/// hosts (self-hosted with no obvious brand marker) collapse to
/// [`HostingService::Unknown`] — the frontend then falls back to
/// Gravatar-only resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostingService {
    GitHub,
    GitLab,
    Bitbucket,
    Gitea,
    Unknown,
}

impl HostingService {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::GitHub => "github",
            Self::GitLab => "gitlab",
            Self::Bitbucket => "bitbucket",
            Self::Gitea => "gitea",
            Self::Unknown => "unknown",
        }
    }
}

/// Inspect `origin`'s URL (or the first remote found) and classify it.
///
/// Returns [`HostingService::Unknown`] for bare repos, zero-remote repos,
/// and self-hosted services whose hostname doesn't include a known brand
/// substring. That's fine — callers treat it as "no provider-native
/// avatar source available, fall back to Gravatar".
pub fn detect_hosting_service(repo_path: &Path) -> HostingService {
    let Ok(repo) = open_repo(repo_path) else {
        return HostingService::Unknown;
    };
    let Some(url) = pick_remote_url(&repo) else {
        return HostingService::Unknown;
    };
    classify_url(&url)
}

/// Prefer `origin`; fall back to the first remote whose URL resolves.
fn pick_remote_url(repo: &gix::Repository) -> Option<String> {
    if let Some(url) = remote_url(repo, "origin") {
        return Some(url);
    }
    let names = repo.remote_names();
    for name in names.iter() {
        let name_str = name.to_string();
        if let Some(url) = remote_url(repo, &name_str) {
            return Some(url);
        }
    }
    None
}

/// Resolve the fetch URL configured for a named remote. `pub(crate)`
/// because [`crate::repo::remote::get_remote_url`] needs the same
/// resolver — keeping it here avoids duplicating the gix dance.
pub(crate) fn remote_url(repo: &gix::Repository, name: &str) -> Option<String> {
    let remote = repo.find_remote(name).ok()?;
    let url = remote.url(gix::remote::Direction::Fetch)?;
    Some(url.to_bstring().to_string())
}

/// Split a remote URL (either `https://…` or `git@…:owner/repo.git`)
/// into `(owner, repo)`. Returns `None` for malformed URLs, paths
/// shorter than two segments, or URLs whose path is empty.
///
/// Handles trailing `.git` and trailing slashes. Does NOT canonicalise
/// case — `Owner/Repo` and `owner/repo` come back distinct because the
/// underlying hosting may treat them as the same canonical path while
/// the URL pattern should reflect what the user pasted.
pub fn parse_repo_identifiers(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    // SSH `git@host:owner/repo.git` — split on the first ':' after the
    // `@`, then treat the remainder as a path.
    let path_segment = if let Some(rest) = trimmed
        .strip_prefix("git@")
        .or_else(|| trimmed.strip_prefix("ssh://git@"))
    {
        let colon = rest.find(':').or_else(|| rest.find('/'))?;
        &rest[colon + 1..]
    } else if let Some(rest) = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
    {
        let slash = rest.find('/')?;
        &rest[slash + 1..]
    } else {
        trimmed
    };
    let cleaned = path_segment
        .trim_start_matches('/')
        .trim_end_matches('/')
        .trim_end_matches(".git");
    let mut parts = cleaned.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// Build a default issue URL pattern from the provider classification
/// and the owner/repo identifiers. Returns `None` for `Unknown` (no
/// canonical pattern) — the caller falls back to the user's global
/// default or per-repo override.
///
/// Patterns use `{id}` as the placeholder for the issue number. The
/// owner / repo are already interpolated.
pub fn provider_issue_url_pattern(
    service: HostingService,
    owner: &str,
    repo: &str,
) -> Option<String> {
    match service {
        HostingService::GitHub => Some(format!("https://github.com/{owner}/{repo}/issues/{{id}}")),
        HostingService::GitLab => Some(format!(
            "https://gitlab.com/{owner}/{repo}/-/issues/{{id}}"
        )),
        HostingService::Bitbucket => Some(format!(
            "https://bitbucket.org/{owner}/{repo}/issues/{{id}}"
        )),
        HostingService::Gitea => Some(format!(
            "https://codeberg.org/{owner}/{repo}/issues/{{id}}"
        )),
        HostingService::Unknown => None,
    }
}

/// Match a remote URL (either `https://…` or `git@…:owner/repo.git`) to a
/// known hosting provider by looking at the hostname substring. Intentionally
/// loose — public host detection is cheap to get right, and mis-classifying a
/// self-hosted GitLab as `Unknown` is harmless (Gravatar fallback). A
/// mis-classification AS GitHub would be harmful (the avatars endpoint
/// wouldn't resolve), so we require the literal `github.com` substring.
pub fn classify_url(url: &str) -> HostingService {
    let lower = url.to_ascii_lowercase();
    if lower.contains("github.com") {
        HostingService::GitHub
    } else if lower.contains("gitlab.com") || lower.contains("gitlab.") {
        // `gitlab.com` OR subdomains of `gitlab.*` (self-hosted GitLab with
        // an obvious brand marker in the hostname).
        HostingService::GitLab
    } else if lower.contains("bitbucket.org") || lower.contains("bitbucket.") {
        HostingService::Bitbucket
    } else if lower.contains("gitea.") || lower.contains("codeberg.org") {
        HostingService::Gitea
    } else {
        HostingService::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_https_url() {
        assert_eq!(
            classify_url("https://github.com/lobinuxsoft/yryvu.git"),
            HostingService::GitHub
        );
    }

    #[test]
    fn github_ssh_url() {
        assert_eq!(
            classify_url("git@github.com:lobinuxsoft/yryvu.git"),
            HostingService::GitHub
        );
    }

    #[test]
    fn gitlab_com_https() {
        assert_eq!(
            classify_url("https://gitlab.com/foo/bar.git"),
            HostingService::GitLab
        );
    }

    #[test]
    fn self_hosted_gitlab_with_brand_subdomain() {
        assert_eq!(
            classify_url("https://gitlab.example.com/foo/bar.git"),
            HostingService::GitLab
        );
    }

    #[test]
    fn bitbucket_cloud() {
        assert_eq!(
            classify_url("https://bitbucket.org/foo/bar.git"),
            HostingService::Bitbucket
        );
    }

    #[test]
    fn codeberg_is_gitea() {
        assert_eq!(
            classify_url("https://codeberg.org/foo/bar.git"),
            HostingService::Gitea
        );
    }

    #[test]
    fn unknown_self_hosted() {
        assert_eq!(
            classify_url("https://git.example.com/foo/bar.git"),
            HostingService::Unknown
        );
    }

    #[test]
    fn parse_identifiers_https() {
        assert_eq!(
            parse_repo_identifiers("https://github.com/lobinuxsoft/yryvu.git"),
            Some(("lobinuxsoft".to_string(), "yryvu".to_string()))
        );
    }

    #[test]
    fn parse_identifiers_ssh() {
        assert_eq!(
            parse_repo_identifiers("git@github.com:lobinuxsoft/yryvu.git"),
            Some(("lobinuxsoft".to_string(), "yryvu".to_string()))
        );
    }

    #[test]
    fn parse_identifiers_ssh_protocol() {
        assert_eq!(
            parse_repo_identifiers("ssh://git@gitlab.com/foo/bar.git"),
            Some(("foo".to_string(), "bar".to_string()))
        );
    }

    #[test]
    fn parse_identifiers_no_dot_git_suffix() {
        assert_eq!(
            parse_repo_identifiers("https://github.com/foo/bar"),
            Some(("foo".to_string(), "bar".to_string()))
        );
    }

    #[test]
    fn parse_identifiers_trailing_slash() {
        assert_eq!(
            parse_repo_identifiers("https://github.com/foo/bar/"),
            Some(("foo".to_string(), "bar".to_string()))
        );
    }

    #[test]
    fn parse_identifiers_rejects_single_segment() {
        assert_eq!(parse_repo_identifiers("https://github.com/foo"), None);
    }

    #[test]
    fn parse_identifiers_rejects_empty() {
        assert_eq!(parse_repo_identifiers(""), None);
        assert_eq!(parse_repo_identifiers("   "), None);
    }

    #[test]
    fn pattern_github() {
        assert_eq!(
            provider_issue_url_pattern(HostingService::GitHub, "foo", "bar").as_deref(),
            Some("https://github.com/foo/bar/issues/{id}")
        );
    }

    #[test]
    fn pattern_gitlab_uses_dash_issues_prefix() {
        assert_eq!(
            provider_issue_url_pattern(HostingService::GitLab, "foo", "bar").as_deref(),
            Some("https://gitlab.com/foo/bar/-/issues/{id}")
        );
    }

    #[test]
    fn pattern_unknown_returns_none() {
        assert_eq!(
            provider_issue_url_pattern(HostingService::Unknown, "foo", "bar"),
            None
        );
    }
}
