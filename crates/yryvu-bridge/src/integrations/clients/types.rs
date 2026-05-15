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
