// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for integration credential persistence (#252).
//! Surface mirrors the frontend's existing signal-only API
//! (\`tokenStorage.ts\` + \`selfHostedHostnames.ts\`) so the swap is a
//! drop-in.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::integrations::{
    self, oauth, AuthData, Comment, CommentTarget, CreateCommentInput, CreateIssueInput,
    CreatePrInput, Identifier, IssueDetail, IssueSummary, PullRequestDetail, PullRequestSummary,
    UserInfo,
};

use super::integration_routing::{is_self_hosted, ProviderFamily};

/// Resolve the sidecar JSON path under the app's local data dir. Same
/// shape as the preferences sidecar — kept separate because they have
/// different schemas + lifecycles.
fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("integrations.json"))
}

/// Load an integration's auth + resolve the effective hostname for
/// dispatch. Centralises the boilerplate every integration command
/// repeats (sidecar load → not-connected error → self-hosted hostname
/// gate). Returns `(AuthData, Option<&'a str>)` where the hostname is
/// `Some` only for self-hosted variants.
async fn load_auth_and_host(app: &AppHandle, integration_type: &str) -> Result<AuthData, String> {
    let path = sidecar_path(app)?;
    let it = integration_type.to_string();
    tauri::async_runtime::spawn_blocking(move || integrations::get_integration(&path as &Path, &it))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("integration '{integration_type}' is not connected"))
}

fn host_for<'a>(integration_type: &str, auth: &'a AuthData) -> Option<&'a str> {
    is_self_hosted(integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten()
}

#[tauri::command]
pub async fn save_integration_token(
    app: AppHandle,
    integration_type: String,
    token: String,
    hostname: Option<String>,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::save_integration(
            &path as &Path,
            &integration_type,
            &token,
            hostname.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_integration_token(
    app: AppHandle,
    integration_type: String,
) -> Result<Option<AuthData>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::get_integration(&path as &Path, &integration_type).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_integration_token(
    app: AppHandle,
    integration_type: String,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::remove_integration(&path as &Path, &integration_type)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_configured_integrations(app: AppHandle) -> Result<Vec<String>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::list_configured(&path as &Path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_integration_hostname(
    app: AppHandle,
    integration_type: String,
    hostname: String,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::set_hostname(&path as &Path, &integration_type, &hostname)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_integration_hostname(
    app: AppHandle,
    integration_type: String,
) -> Result<Option<String>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::get_hostname(&path as &Path, &integration_type).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Validate a token against the provider's API and fetch the
/// authenticated user's profile. Routes by `integration_type` to the
/// appropriate per-provider client. Providers without a client yet
/// return `NotImplemented` — frontend treats that as "skip preflight,
/// stay in mocked connect path".
#[tauri::command]
pub async fn integration_preflight(
    integration_type: String,
    token: String,
    hostname: Option<String>,
) -> Result<UserInfo, String> {
    integrations::preflight(&integration_type, &token, hostname.as_deref())
        .await
        .map_err(|e| e.to_string())
}

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
/// translated server-side via [`super::super::integrations::clients::
/// github::dsl::to_github_search`]; the frontend never has to know
/// GitHub search syntax.
#[tauri::command]
pub async fn integration_list_prs(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    filter_dsl: Option<String>,
) -> Result<Vec<PullRequestSummary>, String> {
    let path = sidecar_path(&app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        move || integrations::get_integration(&path as &Path, &integration_type)
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

/// List issues for `owner/repo` on the named provider. Same auth +
/// hostname path as `integration_list_prs`; supported providers
/// route via [`integrations::list_issues`], others bubble up the
/// typed `NotImplemented` so the frontend can degrade gracefully.
#[tauri::command]
pub async fn integration_list_issues(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
) -> Result<Vec<IssueSummary>, String> {
    let path = sidecar_path(&app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        move || integrations::get_integration(&path as &Path, &integration_type)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))?;
    let hostname = is_self_hosted(&integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten();
    integrations::list_issues(&integration_type, &auth.token, hostname, &owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

/// Fetch one issue's full detail (body + metadata) for the in-app
/// detail panel. Same auth + hostname routing as
/// `integration_list_issues`; supported providers route via
/// [`integrations::get_issue_detail`].
#[tauri::command]
pub async fn integration_get_issue_detail(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
) -> Result<IssueDetail, String> {
    let path = sidecar_path(&app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        move || integrations::get_integration(&path as &Path, &integration_type)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))?;
    let hostname = is_self_hosted(&integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten();
    integrations::get_issue_detail(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        number,
    )
    .await
    .map_err(|e| e.to_string())
}

fn target_from_str(target: &str) -> Result<CommentTarget, String> {
    match target {
        "issue" => Ok(CommentTarget::Issue),
        "pullRequest" => Ok(CommentTarget::PullRequest),
        other => Err(format!("unknown comment target '{other}'")),
    }
}

/// List comments for an issue or pull/merge request. `target` is
/// either `"issue"` or `"pullRequest"`. The number is the per-repo
/// item identifier (issue.number / PR.number / MR.iid).
#[tauri::command]
pub async fn integration_list_comments(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    target: String,
    number: u64,
) -> Result<Vec<Comment>, String> {
    let target = target_from_str(&target)?;
    let auth = load_auth_and_host(&app, &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_comments(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        target,
        number,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Post a new comment to an issue or pull/merge request. Returns the
/// freshly created `Comment` so the UI can append it without a
/// follow-up fetch.
#[tauri::command]
pub async fn integration_create_comment(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    target: String,
    number: u64,
    input: CreateCommentInput,
) -> Result<Comment, String> {
    let target = target_from_str(&target)?;
    let auth = load_auth_and_host(&app, &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::create_comment(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        target,
        number,
        &input,
    )
    .await
    .map_err(|e| e.to_string())
}

/// List repository labels. Populates the labels MultiSelect in the
/// Create Issue / Create PR forms; cross-provider [`Identifier`]
/// shape (GitHub `id == name`, GitLab/Gitea `id` is numeric string).
#[tauri::command]
pub async fn integration_list_labels(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
) -> Result<Vec<Identifier>, String> {
    let auth = load_auth_and_host(&app, &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_labels(&integration_type, &auth.token, hostname, &owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

/// List repository collaborators. Populates the assignees +
/// reviewers MultiSelect; cross-provider [`Identifier`] shape (GitHub
/// + Gitea `id == login/username`, GitLab `id` is numeric string).
#[tauri::command]
pub async fn integration_list_collaborators(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
) -> Result<Vec<Identifier>, String> {
    let auth = load_auth_and_host(&app, &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_collaborators(&integration_type, &auth.token, hostname, &owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

/// List active/open repository milestones. Populates the milestone
/// Select; cross-provider [`Identifier`] shape (numeric id string).
#[tauri::command]
pub async fn integration_list_milestones(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
) -> Result<Vec<Identifier>, String> {
    let auth = load_auth_and_host(&app, &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_milestones(&integration_type, &auth.token, hostname, &owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

/// Create a new pull / merge request on `owner/repo` via the named
/// provider. Same auth + hostname routing as the other PR commands;
/// returns the freshly created [`PullRequestDetail`] so the frontend
/// can route into the detail panel without a follow-up GET.
#[tauri::command]
pub async fn integration_create_pr(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    input: CreatePrInput,
) -> Result<PullRequestDetail, String> {
    let path = sidecar_path(&app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        move || integrations::get_integration(&path as &Path, &integration_type)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))?;
    let hostname = is_self_hosted(&integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten();
    integrations::create_pr(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        &input,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Create a new issue on `owner/repo` via the named provider. Same
/// auth + hostname routing as the other issue commands; returns the
/// freshly created [`IssueDetail`] so the frontend can route to the
/// detail panel without a follow-up GET.
#[tauri::command]
pub async fn integration_create_issue(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    input: CreateIssueInput,
) -> Result<IssueDetail, String> {
    let path = sidecar_path(&app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        move || integrations::get_integration(&path as &Path, &integration_type)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))?;
    let hostname = is_self_hosted(&integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten();
    integrations::create_issue(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        &input,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Returned by [`oauth_begin`]. The frontend opens `authorize_url` in
/// the user's browser via `tauri-plugin-opener` and persists
/// `session_id` so [`oauth_await`] can pick the session up again.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthBeginResult {
    pub session_id: String,
    pub authorize_url: String,
}

/// Phase 1 of the OAuth flow: build the authorize URL for `integration_type`,
/// stage the [`OAuthSession`] in the registry, and return both the URL
/// and an opaque `session_id` to the frontend.
///
/// [`OAuthSession`]: crate::integrations::oauth::OAuthSession
#[tauri::command]
pub async fn oauth_begin(integration_type: String) -> Result<OAuthBeginResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (session, authorize_url) =
            oauth::flow::begin(&integration_type).map_err(|e| e.to_string())?;
        // 128-bit base64 random — opaque to the frontend, decoupled
        // from the CSRF token that already lives in the URL's `state`.
        let session_id = oauth2::CsrfToken::new_random().secret().to_string();
        oauth::state::insert(session_id.clone(), session);
        Ok(OAuthBeginResult {
            session_id,
            authorize_url,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Phase 2 of the OAuth flow: take the parked session by `session_id`,
/// block on the loopback redirect (default 5-min window), and exchange
/// the authorization code for an access token. The token is returned
/// raw — the frontend pipes it through `saveToken` (preflight + persist).
#[tauri::command]
pub async fn oauth_await(session_id: String) -> Result<String, String> {
    let session = oauth::state::take(&session_id)
        .ok_or_else(|| "OAuth session not found (already consumed or cancelled)".to_string())?;
    oauth::flow::await_completion(session, oauth::flow::DEFAULT_FLOW_TIMEOUT)
        .await
        .map_err(|e| e.to_string())
}

/// Drop a parked OAuth session by `session_id` without consuming it.
/// Used when the user dismisses the connect dialog before the browser
/// round-trip completes. Releases the bound loopback port.
#[tauri::command]
pub async fn oauth_cancel(session_id: String) -> Result<(), String> {
    oauth::state::drop_session(&session_id);
    Ok(())
}
