// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};

/// User-info shape returned by every provider's preflight call.
/// camelCase serialization so the frontend store can drop it
/// straight into the `connected` state branch without remapping.
///
/// Mirror of GK's `getUserByIntegrationType` shape (`bundle:203626`).
#[derive(Debug, Clone, Serialize, Deserialize)]
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
