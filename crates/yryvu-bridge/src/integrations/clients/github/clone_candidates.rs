// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub clone-candidate enumeration powering the Clone dialog's
//! `GitHub.com` / `GitHub Enterprise` provider sub-tabs (#374).
//!
//! Hits `GET /user/repos?affiliation=owner,collaborator,organization_member`
//! with `per_page=100`, paginating via the standard `?page=N` query
//! until a short page lands. Returns the cross-provider
//! [`CloneRepoCandidate`] shape; the dropdown grouping happens client-side.

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::{CloneRepoCandidate, OwnerKind};
use super::api_base;

/// Cap on pages we walk before giving up — covers ~5000 repos which
/// is more than every realistic GitHub user has access to. Beyond
/// that the dropdown becomes useless and the UX win is zero.
const MAX_PAGES: u32 = 50;

pub async fn list_clone_candidates(
    token: &str,
    hostname: Option<&str>,
) -> Result<Vec<CloneRepoCandidate>, BackendError> {
    let base = api_base(hostname)?;
    let client = http::client()?;
    let mut out = Vec::new();
    for page in 1..=MAX_PAGES {
        let url = format!(
            "{base}/user/repos?per_page=100&page={page}&affiliation=owner,collaborator,organization_member&sort=full_name"
        );
        let req = http::authed(
            &client,
            Method::GET,
            &url,
            token,
            "application/vnd.github.v3+json",
        );
        let resp = http::execute(req, GITHUB_QUIRKS).await?;
        let raw: Vec<GhRepo> = resp
            .json()
            .await
            .map_err(|e| http::decode_error("decoding /user/repos response", e))?;
        let len = raw.len();
        out.extend(raw.into_iter().map(CloneRepoCandidate::from));
        if len < 100 {
            break;
        }
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct GhRepo {
    name: String,
    full_name: String,
    private: bool,
    description: Option<String>,
    default_branch: Option<String>,
    clone_url: String,
    ssh_url: Option<String>,
    owner: GhOwner,
}

#[derive(Debug, Deserialize)]
struct GhOwner {
    login: String,
    /// `User` | `Organization`. GitHub also returns `Bot` for app
    /// owners which we coerce to `User`.
    #[serde(rename = "type")]
    kind: String,
}

impl From<GhRepo> for CloneRepoCandidate {
    fn from(raw: GhRepo) -> Self {
        let owner_kind = if raw.owner.kind.eq_ignore_ascii_case("organization") {
            OwnerKind::Organization
        } else {
            OwnerKind::User
        };
        Self {
            owner: raw.owner.login,
            owner_kind,
            name: raw.name,
            full_name: raw.full_name,
            clone_url_https: raw.clone_url,
            clone_url_ssh: raw.ssh_url,
            is_private: raw.private,
            description: raw.description,
            default_branch: raw.default_branch,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(login: &str, kind: &str, name: &str, private: bool) -> GhRepo {
        GhRepo {
            name: name.to_string(),
            full_name: format!("{login}/{name}"),
            private,
            description: Some("a repo".to_string()),
            default_branch: Some("main".to_string()),
            clone_url: format!("https://github.com/{login}/{name}.git"),
            ssh_url: Some(format!("git@github.com:{login}/{name}.git")),
            owner: GhOwner {
                login: login.to_string(),
                kind: kind.to_string(),
            },
        }
    }

    #[test]
    fn projects_user_owner() {
        let c: CloneRepoCandidate = raw("alice", "User", "yryvu", false).into();
        assert_eq!(c.owner, "alice");
        assert_eq!(c.owner_kind, OwnerKind::User);
        assert_eq!(c.full_name, "alice/yryvu");
        assert_eq!(c.clone_url_https, "https://github.com/alice/yryvu.git");
        assert_eq!(
            c.clone_url_ssh.as_deref(),
            Some("git@github.com:alice/yryvu.git")
        );
        assert!(!c.is_private);
    }

    #[test]
    fn projects_organization_owner() {
        let c: CloneRepoCandidate = raw("acme", "Organization", "infra", true).into();
        assert_eq!(c.owner_kind, OwnerKind::Organization);
        assert!(c.is_private);
    }

    #[test]
    fn projects_unknown_owner_type_falls_back_to_user() {
        let c: CloneRepoCandidate = raw("bot[bot]", "Bot", "auto", false).into();
        assert_eq!(c.owner_kind, OwnerKind::User);
    }
}
