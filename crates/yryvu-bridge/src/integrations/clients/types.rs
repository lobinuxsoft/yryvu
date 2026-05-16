// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};

/// User-info shape returned by every provider's preflight call.
/// camelCase serialization so the frontend store can drop it
/// straight into the `connected` state branch without remapping.
///
/// Mirror of GK's `getUserByIntegrationType` shape (`bundle:203626`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    /// Stable login / handle (e.g. `lobinuxsoft`).
    pub login: String,
    /// Display name (e.g. `Matias Galarza`). Some providers return
    /// null for users who never set a display name; falls back to
    /// `login` in that case.
    pub display_name: String,
    /// HTTPS URL of the user's avatar (e.g.
    /// `https://avatars.githubusercontent.com/u/12345?v=4`). Always
    /// HTTPS; the frontend uses it as `<img src>` directly.
    pub avatar_url: String,
}

/// Provider-agnostic label shape — GitHub / GitLab / Gitea all model
/// labels as `{ name, color }`. Color is a 6-digit hex string WITHOUT
/// the leading `#` (matching GitHub's REST API); the frontend prepends
/// `#` when applying as a `background-color` CSS value.
///
/// GitLab returns color with a leading `#`; that provider's adapter
/// strips it before producing this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    pub color: String,
}

/// Resolved state of an issue. Cross-provider 2-way enum (open /
/// closed) — none of the supported providers expose a "merged" or
/// "draft" state on issues. Serialises lowercase to match the
/// REST/GraphQL conventions every provider returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueState {
    Open,
    Closed,
}

/// Flat per-issue row payload — the cross-provider shape backing the
/// LeftSidebar `Issues` section. Deliberately leaner than
/// `PullRequestSummary`: no merge state, no head/base refs, no
/// review/CI badges — those concepts don't apply to issues.
///
/// camelCase serialization so the frontend store can drop the
/// response straight into the resource.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub number: u64,
    pub title: String,
    pub state: IssueState,
    pub author: UserInfo,
    /// ISO-8601. Frontend formats "Opened 3 days ago" etc.
    pub created_at: String,
    /// ISO-8601 — latest comment / label / assignee mutation.
    pub updated_at: String,
    /// Public-web URL. Used by the "View in browser" kebab action +
    /// the row's default-click behaviour.
    pub html_url: String,
    /// Labels applied to the issue.
    #[serde(default)]
    pub labels: Vec<Label>,
    /// Assignees. Avatar cluster, max 3 visible + overflow.
    #[serde(default)]
    pub assignees: Vec<UserInfo>,
    /// Comment count — surfaced as a small numeric pill on the row
    /// since issues often live or die by their discussion thread.
    pub comments: u64,
}

/// Cross-provider issue/PR comment payload. `kind` tells the client
/// which API surface the comment came from so refetch / delete can
/// route correctly later; the field is decorative for v1 (read-only).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: UserInfo,
    pub created_at: String,
    pub updated_at: String,
    pub body: String,
    pub html_url: String,
}

/// Identifies which item a comment listing targets. Both `Issue` and
/// `PullRequest` flow through the same issue-comments endpoint on
/// GitHub + Gitea; GitLab splits them into `issues/notes` and
/// `merge_requests/notes`.
#[derive(Debug, Clone, Copy)]
pub enum CommentTarget {
    Issue,
    PullRequest,
}

/// Inputs for posting a new comment.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommentInput {
    pub body: String,
}

/// Provider-agnostic identifier carried in dropdown options. `id` is
/// the opaque string the backend re-sends on create — for GitHub it's
/// the login/name, for GitLab it's the numeric id stringified, for
/// Gitea it's the numeric id (labels/milestones) or username (users).
/// `displayName` is what the UI renders; `avatarUrl` is optional and
/// only populated for user-shaped options.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identifier {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub avatar_url: String,
    /// Optional color hex (label-shaped options use this; others
    /// leave it empty).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
}

/// Inputs for creating a new issue. Cross-provider — opaque
/// `Identifier.id` strings flow through, interpreted by each provider
/// adapter (login vs numeric id) before hitting the API.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIssueInput {
    pub title: String,
    #[serde(default)]
    pub body: String,
    /// Label identifiers — provider semantics:
    /// - GitHub: label names.
    /// - GitLab: numeric label IDs stringified.
    /// - Gitea: numeric label IDs stringified.
    #[serde(default)]
    pub labels: Vec<String>,
    /// Assignee identifiers — GitHub/Gitea: usernames; GitLab:
    /// numeric user IDs stringified.
    #[serde(default)]
    pub assignees: Vec<String>,
    /// Milestone identifier — GitHub/GitLab/Gitea: numeric id
    /// stringified. None means "no milestone".
    #[serde(default)]
    pub milestone: Option<String>,
}

/// Inputs for creating a new pull / merge request. Cross-provider
/// minimal shape — every provider needs source + target branch, a
/// title, and an optional markdown body. GitHub + GitLab support an
/// initial-draft toggle (Gitea ignores it — its API has no draft
/// concept at create time, drafts are inferred from a `[WIP]` /
/// `Draft:` title prefix).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrInput {
    pub title: String,
    #[serde(default)]
    pub body: String,
    /// Source branch (the branch carrying the changes — `head` in
    /// GitHub terms, `source_branch` in GitLab terms).
    pub head_ref: String,
    /// Target branch (where the changes land — `base` in GitHub
    /// terms, `target_branch` in GitLab terms).
    pub base_ref: String,
    /// Open as draft. Honored by GitHub + GitLab; Gitea ignores it.
    #[serde(default)]
    pub draft: bool,
    /// Label identifiers — same semantics as [`CreateIssueInput::labels`].
    #[serde(default)]
    pub labels: Vec<String>,
    /// Assignee identifiers — same semantics as
    /// [`CreateIssueInput::assignees`].
    #[serde(default)]
    pub assignees: Vec<String>,
    /// Reviewer identifiers — same semantics as `assignees`. GitHub
    /// resolves via a follow-up `POST /pulls/{n}/requested_reviewers`
    /// because the create endpoint doesn't accept reviewers inline.
    #[serde(default)]
    pub reviewers: Vec<String>,
    /// Milestone identifier — same semantics as
    /// [`CreateIssueInput::milestone`].
    #[serde(default)]
    pub milestone: Option<String>,
}

/// Project-level merge configuration surfaced by GitLab. The frontend
/// merge form uses these to gate the method radios + the squash
/// checkbox so only project-allowed paths are offered to the user.
///
/// GitHub + Gitea don't expose this concept (their merge availability is
/// repo-write-permission gated and not configurable per-repo at this
/// granularity), so [`PullRequestDetail::project_settings`] stays
/// `None` for those providers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMergeSettings {
    pub merge_method: ProjectMergeMethod,
    pub squash_option: ProjectSquashOption,
    /// Project-level "Auto-delete source branch on merge" default. The
    /// merge form pre-checks the delete-branch checkbox when this is
    /// true. Frontend-visible only.
    pub remove_source_branch_after_merge_default: bool,
    /// "Allow merge if pipeline is skipped" — when false, the
    /// frontend disables the merge button while pipeline is `skipped`.
    pub allow_merge_on_skipped_pipeline: bool,
}

/// GitLab project setting controlling how merges are committed. Maps
/// 1:1 to the GraphQL `ProjectMergeMethod` enum: `MERGE`, `REBASE_MERGE`,
/// `FF`. camelCase serialization for the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectMergeMethod {
    /// Standard merge — allows merge commits.
    Merge,
    /// Semi-linear history — source must be rebased onto target before
    /// the merge commit lands.
    RebaseMerge,
    /// Fast-forward only — no merge commits, source must already be
    /// linear on top of target.
    Ff,
}

/// GitLab project setting controlling whether commits are squashed at
/// merge time. Maps 1:1 to `ProjectMergeRequestsSquashOption`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectSquashOption {
    /// Squashing is forbidden by the project. Checkbox hidden.
    Never,
    /// Squashing is mandatory. Checkbox shown disabled+checked.
    Always,
    /// Squash checkbox shown enabled, defaults unchecked.
    DefaultOff,
    /// Squash checkbox shown enabled, defaults checked.
    DefaultOn,
}

/// Cross-provider repo candidate surfaced by the Clone dialog's
/// per-provider sub-tabs (#374). Single shape, populated by each
/// provider client from whatever native repo enumeration API the
/// upstream offers (REST `/user/repos` for GitHub, GraphQL projects
/// for GitLab, REST `/repos/search` for Gitea). The frontend groups
/// the list by `owner` + `owner_kind` to render the GK-style
/// org-headered dropdown and uses `clone_url_https` as the canonical
/// URL passed into the existing `clone_repository` flow.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRepoCandidate {
    /// Owner login / namespace (GitHub `login`, GitLab group `path`,
    /// Gitea owner `login`). Drives the dropdown grouping.
    pub owner: String,
    /// Whether the owner is a personal account or an organization /
    /// group. Drives the personal-first ordering in the dropdown.
    pub owner_kind: OwnerKind,
    /// Repo name without the owner prefix (e.g. `yryvu`).
    pub name: String,
    /// `owner/name` for display + dedup. GitLab self-hosted may have
    /// nested groups (`group/subgroup/repo`); we keep the full path.
    pub full_name: String,
    /// HTTPS clone URL — the one we always pass into the existing
    /// `clone_repository` flow.
    pub clone_url_https: String,
    /// SSH clone URL when the provider exposes it (GitHub does, Gitea
    /// does, GitLab does via GraphQL `sshUrlToRepo`). Surfaced for
    /// future "Clone via SSH" toggle; v1 always uses HTTPS.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clone_url_ssh: Option<String>,
    pub is_private: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
}

/// Whether a [`CloneRepoCandidate`]'s owner is a personal account or
/// an organization / group. Drives the dropdown's personal-first
/// ordering and the section-header rendering ("YOUR REPOS" vs the
/// org name in CAPS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OwnerKind {
    User,
    Organization,
}

/// Extended issue payload for the detail panel — superset of
/// [`IssueSummary`] with body markdown + the closed timestamp.
/// Mirrors GK's `IssueTracker-*` detail surface in fields exposed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    pub number: u64,
    pub title: String,
    pub state: IssueState,
    pub author: UserInfo,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub html_url: String,
    pub body: String,
    pub milestone: Option<String>,
    #[serde(default)]
    pub labels: Vec<Label>,
    #[serde(default)]
    pub assignees: Vec<UserInfo>,
    pub comments: u64,
}
