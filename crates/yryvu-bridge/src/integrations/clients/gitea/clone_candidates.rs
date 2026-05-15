// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo clone-candidate enumeration powering the Clone
//! dialog's `Gitea` / `Gitea Self-Hosted` provider sub-tabs (#374).
//!
//! Hits `GET /repos/search?limit=50&private=true&exclusive=false` with
//! the authed user as the implicit filter — Gitea returns repos the
//! authenticated user can access (own, collaborator, org member).
//! Paginates via `?page=N`.

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITEA_QUIRKS};
use super::super::types::{CloneRepoCandidate, OwnerKind};
use super::api_base;

const MAX_PAGES: u32 = 50;

pub async fn list_clone_candidates(
    token: &str,
    hostname: Option<&str>,
) -> Result<Vec<CloneRepoCandidate>, BackendError> {
    let base = api_base(hostname)?;
    let client = http::client()?;
    let mut out = Vec::new();
    for page in 1..=MAX_PAGES {
        let url = format!("{base}/repos/search?limit=50&page={page}&private=true&exclusive=false");
        let req = http::authed(&client, Method::GET, &url, token, "application/json");
        let resp = http::execute(req, GITEA_QUIRKS).await?;
        let body: GiteaSearchResp = resp
            .json()
            .await
            .map_err(|e| http::decode_error("decoding /repos/search response", e))?;
        let len = body.data.len();
        out.extend(body.data.into_iter().map(CloneRepoCandidate::from));
        if len < 50 {
            break;
        }
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct GiteaSearchResp {
    data: Vec<GiteaRepo>,
}

#[derive(Debug, Deserialize)]
struct GiteaRepo {
    name: String,
    full_name: String,
    private: bool,
    description: Option<String>,
    default_branch: Option<String>,
    clone_url: String,
    ssh_url: Option<String>,
    owner: GiteaOwner,
}

#[derive(Debug, Deserialize)]
struct GiteaOwner {
    login: String,
    /// Gitea returns `User` | `Organization` (capitalised). No `Bot`
    /// concept here — the integrations table is humans + orgs.
    #[serde(rename = "type", default)]
    kind: Option<String>,
}

impl From<GiteaRepo> for CloneRepoCandidate {
    fn from(raw: GiteaRepo) -> Self {
        let owner_kind = match raw.owner.kind.as_deref() {
            Some(k) if k.eq_ignore_ascii_case("organization") => OwnerKind::Organization,
            _ => OwnerKind::User,
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

    fn raw(login: &str, kind: Option<&str>, name: &str, private: bool) -> GiteaRepo {
        GiteaRepo {
            name: name.to_string(),
            full_name: format!("{login}/{name}"),
            private,
            description: None,
            default_branch: Some("main".to_string()),
            clone_url: format!("https://gitea.example.com/{login}/{name}.git"),
            ssh_url: Some(format!("git@gitea.example.com:{login}/{name}.git")),
            owner: GiteaOwner {
                login: login.to_string(),
                kind: kind.map(String::from),
            },
        }
    }

    #[test]
    fn projects_user_owner() {
        let c: CloneRepoCandidate = raw("alice", Some("User"), "yryvu", false).into();
        assert_eq!(c.owner_kind, OwnerKind::User);
        assert!(!c.is_private);
    }

    #[test]
    fn projects_organization_owner() {
        let c: CloneRepoCandidate = raw("acme", Some("Organization"), "infra", true).into();
        assert_eq!(c.owner_kind, OwnerKind::Organization);
    }

    #[test]
    fn projects_missing_owner_kind_defaults_to_user() {
        let c: CloneRepoCandidate = raw("bob", None, "personal", false).into();
        assert_eq!(c.owner_kind, OwnerKind::User);
    }
}
