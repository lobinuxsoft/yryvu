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

/// The canonical upstream hosting platforms Chajá recognises. Unknown
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
            classify_url("https://github.com/lobinuxsoft/chaja.git"),
            HostingService::GitHub
        );
    }

    #[test]
    fn github_ssh_url() {
        assert_eq!(
            classify_url("git@github.com:lobinuxsoft/chaja.git"),
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
}
