// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab clone-candidate enumeration powering the Clone dialog's
//! `GitLab.com` / `GitLab Self-Managed` provider sub-tabs (#374).
//!
//! GraphQL single round-trip: pulls `currentUser.projectMemberships`
//! (every project the user is a direct member of, owner or otherwise).
//! Group projects come along for free since membership crosses
//! groups. GitLab self-hosted may have nested groups
//! (`group/subgroup/repo`); the projection keeps the full path as
//! `full_name` so the dropdown rendering stays unambiguous.

use reqwest::Method;
use serde::Deserialize;
use serde_json::json;

use crate::backend::BackendError;

use super::super::http::{self, GITLAB_QUIRKS};
use super::super::types::{CloneRepoCandidate, OwnerKind};
use super::graphql_endpoint;

/// One GraphQL doc, paginated via the standard cursor on
/// `projectMemberships`. 100 per page covers ~5000 memberships before
/// it becomes useless to scroll, same cap as the GitHub side.
const QUERY: &str = "query($cursor: String) { \
    currentUser { \
        projectMemberships(first: 100, after: $cursor) { \
            pageInfo { hasNextPage endCursor } \
            nodes { project { \
                name fullPath description visibility \
                httpUrlToRepo sshUrlToRepo \
                repository { rootRef } \
                group { fullPath } \
            } } \
        } \
    } }";

const MAX_PAGES: u32 = 50;

pub async fn list_clone_candidates(
    token: &str,
    hostname: Option<&str>,
) -> Result<Vec<CloneRepoCandidate>, BackendError> {
    let endpoint = graphql_endpoint(hostname)?;
    let client = http::client()?;
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let req = http::authed(&client, Method::POST, &endpoint, token, "application/json").json(
            &json!({
                "query": QUERY,
                "variables": { "cursor": cursor }
            }),
        );
        let resp = http::execute(req, GITLAB_QUIRKS).await?;
        let body: GlResp = resp
            .json()
            .await
            .map_err(|e| http::decode_error("decoding /graphql clone-candidates response", e))?;
        if let Some(errors) = body.errors {
            if !errors.is_empty() {
                return Err(BackendError::NetworkError {
                    detail: format!(
                        "GraphQL errors: {}",
                        errors
                            .iter()
                            .map(|e| e.message.as_str())
                            .collect::<Vec<_>>()
                            .join("; ")
                    ),
                });
            }
        }
        let memberships = body
            .data
            .and_then(|d| d.current_user)
            .map(|u| u.project_memberships)
            .unwrap_or(GlConnection {
                page_info: GlPageInfo {
                    has_next_page: false,
                    end_cursor: None,
                },
                nodes: Vec::new(),
            });
        for membership in memberships.nodes {
            if let Some(project) = membership.project {
                out.push(project.into());
            }
        }
        if !memberships.page_info.has_next_page {
            break;
        }
        cursor = memberships.page_info.end_cursor;
        if cursor.is_none() {
            break;
        }
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct GlResp {
    #[serde(default)]
    data: Option<GlData>,
    #[serde(default)]
    errors: Option<Vec<GlGraphqlError>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlData {
    current_user: Option<GlCurrentUser>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlCurrentUser {
    project_memberships: GlConnection,
}

#[derive(Debug, Deserialize)]
struct GlConnection {
    #[serde(rename = "pageInfo")]
    page_info: GlPageInfo,
    nodes: Vec<GlMembership>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlPageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GlMembership {
    project: Option<GlProject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlProject {
    name: String,
    full_path: String,
    description: Option<String>,
    /// `private` | `internal` | `public`. We collapse `public` →
    /// is_private:false, the rest → true (closer to the user's
    /// "needs auth?" mental model than the literal flag).
    visibility: Option<String>,
    http_url_to_repo: String,
    ssh_url_to_repo: Option<String>,
    repository: Option<GlRepository>,
    group: Option<GlGroup>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlRepository {
    root_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlGroup {
    full_path: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GlGraphqlError {
    message: String,
}

impl From<GlProject> for CloneRepoCandidate {
    fn from(raw: GlProject) -> Self {
        // `full_path` is `group/subgroup/repo` for nested groups.
        // Owner = everything but the last segment; if there's no
        // group prefix the project is owned by the user namespace.
        let (owner, owner_kind) = match raw.group.as_ref() {
            Some(g) => (g.full_path.clone(), OwnerKind::Organization),
            None => {
                let owner = raw
                    .full_path
                    .rsplit_once('/')
                    .map(|(o, _)| o.to_string())
                    .unwrap_or_else(|| raw.full_path.clone());
                (owner, OwnerKind::User)
            }
        };
        let is_private = !matches!(raw.visibility.as_deref(), Some("public"));
        Self {
            owner,
            owner_kind,
            name: raw.name,
            full_name: raw.full_path,
            clone_url_https: raw.http_url_to_repo,
            clone_url_ssh: raw.ssh_url_to_repo,
            is_private,
            description: raw.description,
            default_branch: raw.repository.and_then(|r| r.root_ref),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, full_path: &str, group: Option<&str>, visibility: &str) -> GlProject {
        GlProject {
            name: name.to_string(),
            full_path: full_path.to_string(),
            description: None,
            visibility: Some(visibility.to_string()),
            http_url_to_repo: format!("https://gitlab.com/{full_path}.git"),
            ssh_url_to_repo: Some(format!("git@gitlab.com:{full_path}.git")),
            repository: Some(GlRepository {
                root_ref: Some("main".to_string()),
            }),
            group: group.map(|g| GlGroup {
                full_path: g.to_string(),
            }),
        }
    }

    #[test]
    fn projects_personal_namespace() {
        let c: CloneRepoCandidate = project("yryvu", "alice/yryvu", None, "private").into();
        assert_eq!(c.owner, "alice");
        assert_eq!(c.owner_kind, OwnerKind::User);
        assert_eq!(c.full_name, "alice/yryvu");
        assert!(c.is_private);
    }

    #[test]
    fn projects_group_namespace_marks_organization() {
        let c: CloneRepoCandidate = project("infra", "acme/infra", Some("acme"), "internal").into();
        assert_eq!(c.owner, "acme");
        assert_eq!(c.owner_kind, OwnerKind::Organization);
        assert!(
            c.is_private,
            "internal visibility should map to is_private:true"
        );
    }

    #[test]
    fn projects_public_visibility_is_not_private() {
        let c: CloneRepoCandidate = project("docs", "acme/docs", Some("acme"), "public").into();
        assert!(!c.is_private);
    }

    #[test]
    fn projects_nested_group_path_kept_in_full_name() {
        let c: CloneRepoCandidate = project(
            "service",
            "acme/platform/service",
            Some("acme/platform"),
            "private",
        )
        .into();
        assert_eq!(c.owner, "acme/platform");
        assert_eq!(c.full_name, "acme/platform/service");
    }
}
