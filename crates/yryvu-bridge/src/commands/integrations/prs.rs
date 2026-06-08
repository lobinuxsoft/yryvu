// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use tauri::AppHandle;

use crate::integrations::{self, PullRequestSummary};

use super::super::integration_routing::{is_self_hosted, ProviderFamily};
use super::sidecar_path;

/// List pull requests for `owner/repo` on the named provider.
///
/// Two dispatch paths:
///
/// - **No `filterDsl`** (and no provider-only-supported sort token):
///   REST `GET /pulls` + a GraphQL `enrich` round-trip for
///   review/CI status. Faster on the happy path.
/// - **`filterDsl` non-empty**: GraphQL `search` connection in a
///   single round-trip; the response already carries review/CI so
///   no enrichment step runs. Used by the filter toolbar.
///
/// `filterDsl` is the raw user text from the toolbar's freeform
/// input (post-dropdown serialization). The DSL is parsed and
/// translated server-side via [`crate::integrations::clients::github::
/// dsl::to_github_search`]; the frontend never has to know GitHub
/// search syntax.
#[tauri::command]
pub async fn integration_list_prs(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
    filter_dsl: Option<String>,
) -> Result<Vec<PullRequestSummary>, String> {
    let path = sidecar_path(&app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        let profile_id = profile_id.clone();
        move || {
            integrations::get_integration(&path as &Path, profile_id.as_deref(), &integration_type)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))?;

    let hostname = is_self_hosted(&integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten();
    // Treat blank / whitespace-only DSL as "no filter".
    let dsl = filter_dsl
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    match (
        ProviderFamily::from_integration_type(&integration_type),
        dsl,
    ) {
        // GitHub list path: REST `/pulls` + soft-fail GraphQL enrich.
        (ProviderFamily::Github, None) => {
            let mut prs =
                integrations::list_prs(&integration_type, &auth.token, hostname, &owner, &repo)
                    .await
                    .map_err(|e| e.to_string())?;
            if let Err(err) =
                integrations::enrich_github_prs(&auth.token, hostname, &owner, &repo, &mut prs)
                    .await
            {
                eprintln!("github GraphQL enrichment failed (badges blank): {err}");
            }
            Ok(prs)
        }
        // GitHub search path: GraphQL already enriches; no second call.
        (ProviderFamily::Github, Some(dsl)) => {
            integrations::search_github_prs(&auth.token, hostname, &owner, &repo, dsl)
                .await
                .map_err(|e| e.to_string())
        }
        // GitLab: GraphQL on both paths, no separate enrich.
        (ProviderFamily::Gitlab, None) => {
            integrations::list_gitlab_mrs(&auth.token, hostname, &owner, &repo)
                .await
                .map_err(|e| e.to_string())
        }
        (ProviderFamily::Gitlab, Some(dsl)) => {
            integrations::search_gitlab_mrs(&auth.token, hostname, &owner, &repo, dsl)
                .await
                .map_err(|e| e.to_string())
        }
        // Gitea: REST only, badges null (no GraphQL upstream).
        (ProviderFamily::Gitea, None) => {
            integrations::list_gitea_prs(&auth.token, hostname, &owner, &repo)
                .await
                .map_err(|e| e.to_string())
        }
        (ProviderFamily::Gitea, Some(dsl)) => {
            integrations::search_gitea_prs(&auth.token, hostname, &owner, &repo, dsl)
                .await
                .map_err(|e| e.to_string())
        }
        // Other providers: dispatcher returns NotImplemented until
        // per-provider clients land.
        (ProviderFamily::Other, _) => {
            integrations::list_prs(&integration_type, &auth.token, hostname, &owner, &repo)
                .await
                .map_err(|e| e.to_string())
        }
    }
}
