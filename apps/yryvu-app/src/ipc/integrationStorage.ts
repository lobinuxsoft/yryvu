// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Combined credentials for an integration. The token always comes
 * from the OS keyring; the hostname comes from the JSON sidecar
 * (only set for self-hosted variants). Returned together so callers
 * get both in a single round-trip.
 */
export interface AuthData {
  token: string;
  hostname: string | null;
}

/**
 * Persist credentials for `integrationType`. The Rust backend writes
 * the token to the OS keyring (libsecret / Keychain / Credential Vault)
 * and the metadata (hostname + `configured: true`) to the
 * `integrations.json` sidecar.
 *
 * Errors propagate as backend strings; the caller maps known
 * substrings to user-facing toasts:
 * - `"OS keyring service unavailable"` → render keyring CTA
 * - `"keyring failed: <detail>"` → render generic error
 * - `"sidecar schema version"` → render schema-mismatch error
 */
export function saveIntegrationToken(
  integrationType: string,
  token: string,
  hostname?: string,
): Promise<void> {
  return invoke<void>("save_integration_token", {
    integrationType,
    token,
    hostname: hostname ?? null,
  });
}

/**
 * Fetch credentials for `integrationType`. Returns `null` when no
 * token is stored — that's not an error condition, it's the expected
 * state for an unconfigured integration.
 */
export function getIntegrationToken(
  integrationType: string,
): Promise<AuthData | null> {
  return invoke<AuthData | null>("get_integration_token", { integrationType });
}

/**
 * Wipe credentials for `integrationType`. Removes the keyring entry
 * AND clears the sidecar's `configured` flag. The hostname (if any)
 * is preserved so a subsequent re-connect doesn't lose the user's
 * URL config.
 */
export function removeIntegrationToken(integrationType: string): Promise<void> {
  return invoke<void>("remove_integration_token", { integrationType });
}

/**
 * Enumerate integration types whose sidecar entry has `configured: true`.
 * Cheap (no keyring round-trip) — drives the sub-tab sidebar's
 * "connected" indicator dot via a single call on Preferences mount.
 */
export function listConfiguredIntegrations(): Promise<string[]> {
  return invoke<string[]>("list_configured_integrations", {});
}

/**
 * Set just the hostname for a self-hosted integration. The user can
 * configure the URL before pasting / importing the token.
 */
export function setIntegrationHostname(
  integrationType: string,
  hostname: string,
): Promise<void> {
  return invoke<void>("set_integration_hostname", { integrationType, hostname });
}

/**
 * Read just the hostname for a self-hosted integration. Returns `null`
 * when no hostname is configured.
 */
export function getIntegrationHostname(
  integrationType: string,
): Promise<string | null> {
  return invoke<string | null>("get_integration_hostname", { integrationType });
}

/**
 * User info returned by `integration_preflight`. Mirrors the Rust
 * `UserInfo` struct (camelCase serialization).
 */
export interface UserInfo {
  login: string;
  displayName: string;
  avatarUrl: string;
}

/**
 * Validate `token` against the provider's API and fetch the
 * authenticated user's profile. The frontend calls this:
 * - right after `saveIntegrationToken` so the user sees real avatar +
 *   name immediately on save (and bad tokens fail loudly).
 * - on app start to hydrate the connected state for every persisted
 *   integration.
 *
 * Errors propagate as backend strings; the caller matches on
 * substrings to render the right toast CTA:
 * - `"token rejected by provider"` → re-enter or regenerate token
 * - `"insufficient scopes"` → grant the missing scopes
 * - `"rate-limited"` → wait until the reset timestamp
 * - `"network error"` → check connectivity
 * - `"not implemented"` → silently skip (provider's per-PR client
 *   hasn't landed yet)
 */
export function integrationPreflight(
  integrationType: string,
  token: string,
  hostname?: string,
): Promise<UserInfo> {
  return invoke<UserInfo>("integration_preflight", {
    integrationType,
    token,
    hostname: hostname ?? null,
  });
}

/**
 * Resolved pull-request state — `merged` is inferred when GitHub
 * returns `state: "closed"` plus a non-null `merged_at`.
 */
export type PullRequestState = "open" | "closed" | "merged";

/**
 * Code-review decision surfaced on the row card's review badge.
 * `null` when GraphQL enrichment skipped / failed.
 */
export type ReviewDecision =
  | "approved"
  | "changes_requested"
  | "review_required";

/**
 * CI rollup state surfaced on the row card's CI badge. `null` when
 * the head commit has no checks or enrichment skipped.
 */
export type CiStatus =
  | "success"
  | "failure"
  | "pending"
  | "error"
  | "expected";

/**
 * Provider-agnostic label shape — `color` is a 6-digit hex string
 * WITHOUT the leading `#`. CSS callers prepend `#`.
 */
export interface Label {
  name: string;
  color: string;
}

/**
 * Flat row payload returned by `integration_list_prs`. Wave-2 fields
 * (`labels`, `assignees`, `requestedReviewers`, `reviewDecision`,
 * `ciStatus`) may arrive empty / null when the GraphQL enrichment
 * path skipped or the repo simply has no review activity.
 */
export interface PullRequestSummary {
  number: number;
  title: string;
  state: PullRequestState;
  draft: boolean;
  author: UserInfo;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  baseRef: string;
  headRef: string;
  /// Head commit SHA. Used by the "Go to in graph" kebab action to
  /// navigate the commit graph to this PR's tip. Empty string when
  /// the backend couldn't resolve it (defensive — GitHub's live API
  /// always returns a SHA).
  headSha: string;
  labels: Label[];
  assignees: UserInfo[];
  requestedReviewers: UserInfo[];
  reviewDecision: ReviewDecision | null;
  ciStatus: CiStatus | null;
}

/**
 * List pull requests for `owner/repo` on the named provider. The
 * backend pulls the token + hostname from the keyring + sidecar — the
 * frontend never holds credentials.
 *
 * `filterDsl` is the raw user text from the filter toolbar (or any
 * pre-serialised composition of dropdown state). When non-empty the
 * backend dispatches to GraphQL `search` (single round-trip, results
 * already enriched). When empty the backend uses REST `/pulls` plus a
 * soft-fail GraphQL enrichment pass.
 *
 * Errors propagate as backend strings; the caller matches on
 * substrings to surface toasts:
 * - `"is not connected"` — integration was never configured / was
 *   disconnected. The UI should fall back to the inline-connect CTA.
 * - `"token rejected by provider"` — token revoked since last preflight.
 * - `"rate-limited"` — back off until reset.
 * - `"not found or token cannot see it"` — owner/repo wrong or the
 *   token lacks the `repo` scope for that repository.
 */
export function integrationListPrs(
  integrationType: string,
  owner: string,
  repo: string,
  filterDsl?: string,
): Promise<PullRequestSummary[]> {
  return invoke<PullRequestSummary[]>("integration_list_prs", {
    integrationType,
    owner,
    repo,
    filterDsl: filterDsl ?? null,
  });
}

/// Cross-provider issue state. None of the supported providers
/// (GitHub / GitLab / Gitea) expose anything beyond open/closed on
/// issues.
export type IssueState = "open" | "closed";

/// Cross-provider issue row payload. Deliberately leaner than
/// `PullRequestSummary` — no merge state, no head/base refs, no
/// review/CI badges.
export interface IssueSummary {
  number: number;
  title: string;
  state: IssueState;
  author: UserInfo;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  labels: Label[];
  assignees: UserInfo[];
  comments: number;
}

/// List issues for `owner/repo` on the named provider. Same auth +
/// error envelope as `integrationListPrs`. The frontend filters
/// providers it can't render via the discriminated resource result;
/// the backend bubbles up a typed `NotImplemented` for the rest.
export function integrationListIssues(
  integrationType: string,
  owner: string,
  repo: string,
): Promise<IssueSummary[]> {
  return invoke<IssueSummary[]>("integration_list_issues", {
    integrationType,
    owner,
    repo,
  });
}

/// Extended issue payload for the detail panel — superset of
/// `IssueSummary` with body markdown + closed_at + milestone.
export interface IssueDetail {
  number: number;
  title: string;
  state: IssueState;
  author: UserInfo;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  htmlUrl: string;
  body: string;
  milestone: string | null;
  labels: Label[];
  assignees: UserInfo[];
  comments: number;
}

/// Fetch a single issue's full detail. Same provider-routing as
/// `integrationListIssues`; the backend returns the cross-provider
/// `IssueDetail` shape.
export function integrationGetIssueDetail(
  integrationType: string,
  owner: string,
  repo: string,
  number: number,
): Promise<IssueDetail> {
  return invoke<IssueDetail>("integration_get_issue_detail", {
    integrationType,
    owner,
    repo,
    number,
  });
}

/// Cross-provider comment payload — issues + PRs share this shape.
export interface Comment {
  id: string;
  author: UserInfo;
  createdAt: string;
  updatedAt: string;
  body: string;
  htmlUrl: string;
}

/// Comment target — `"issue"` or `"pullRequest"`. GitHub + Gitea use
/// the same endpoint for both; GitLab routes via different paths.
export type CommentTarget = "issue" | "pullRequest";

export function integrationListComments(
  integrationType: string,
  owner: string,
  repo: string,
  target: CommentTarget,
  number: number,
): Promise<Comment[]> {
  return invoke<Comment[]>("integration_list_comments", {
    integrationType,
    owner,
    repo,
    target,
    number,
  });
}

export function integrationCreateComment(
  integrationType: string,
  owner: string,
  repo: string,
  target: CommentTarget,
  number: number,
  body: string,
): Promise<Comment> {
  return invoke<Comment>("integration_create_comment", {
    integrationType,
    owner,
    repo,
    target,
    number,
    input: { body },
  });
}

/// Provider-agnostic identifier carried in dropdown options. `id` is
/// what we re-send on create; `displayName` is what we render. For
/// label-shaped options `color` is a hex string (no leading `#`).
export interface Identifier {
  id: string;
  displayName: string;
  avatarUrl?: string;
  color?: string;
}

export function integrationListLabels(
  integrationType: string,
  owner: string,
  repo: string,
): Promise<Identifier[]> {
  return invoke<Identifier[]>("integration_list_labels", {
    integrationType,
    owner,
    repo,
  });
}

export function integrationListCollaborators(
  integrationType: string,
  owner: string,
  repo: string,
): Promise<Identifier[]> {
  return invoke<Identifier[]>("integration_list_collaborators", {
    integrationType,
    owner,
    repo,
  });
}

export function integrationListMilestones(
  integrationType: string,
  owner: string,
  repo: string,
): Promise<Identifier[]> {
  return invoke<Identifier[]>("integration_list_milestones", {
    integrationType,
    owner,
    repo,
  });
}

/// Cross-provider input for creating a pull / merge request. Source
/// + target branches are required everywhere; draft state is honored
/// by GitHub + GitLab (encoded via title prefix), Gitea route is
/// `NotImplemented` until Gitea PR detail lands. `labels`,
/// `assignees`, `reviewers` and `milestone` are arrays of opaque
/// `Identifier.id` strings the user picked from the dropdowns.
export interface CreatePrInput {
  title: string;
  body?: string;
  headRef: string;
  baseRef: string;
  draft?: boolean;
  labels?: string[];
  assignees?: string[];
  reviewers?: string[];
  milestone?: string;
}

/// Create a new pull / merge request on `owner/repo`. Returns the
/// freshly created `PullRequestDetail`. Imported lazily via the same
/// module barrel that exposes `PullRequestDetail`.
export function integrationCreatePr(
  integrationType: string,
  owner: string,
  repo: string,
  input: CreatePrInput,
): Promise<import("./pr_detail").PullRequestDetail> {
  return invoke<import("./pr_detail").PullRequestDetail>("integration_create_pr", {
    integrationType,
    owner,
    repo,
    input,
  });
}

/// Cross-provider input for creating an issue. `title` required;
/// `body` markdown + selector arrays optional. `labels`, `assignees`
/// and `milestone` carry opaque `Identifier.id` strings the user
/// picked from the dropdowns.
export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: string;
}

/// Create a new issue on `owner/repo`. Returns the freshly created
/// `IssueDetail`, ready to route into the detail panel without a
/// follow-up fetch.
export function integrationCreateIssue(
  integrationType: string,
  owner: string,
  repo: string,
  input: CreateIssueInput,
): Promise<IssueDetail> {
  return invoke<IssueDetail>("integration_create_issue", {
    integrationType,
    owner,
    repo,
    input,
  });
}

/**
 * Result of `oauth_begin` — the URL to open in the user's browser plus
 * an opaque session id that `oauth_await` / `oauth_cancel` need.
 */
export interface OAuthBeginResult {
  sessionId: string;
  authorizeUrl: string;
}

/**
 * Phase 1 of the OAuth flow. The backend binds an ephemeral loopback
 * port, generates PKCE + CSRF state, builds the provider's authorize
 * URL, and parks the session under `sessionId` for `oauth_await` to
 * pick up. The caller is expected to open `authorizeUrl` via
 * `tauri-plugin-opener` and persist `sessionId` until
 * `oauth_await` returns.
 *
 * Errors:
 * - `"OAuth not configured"` — provider's `client_id` is empty (no
 *   `.env.local` / Repo Secret bake). Frontend should disable the
 *   OAuth button when `provider.isConfigured()` is false to avoid
 *   surfacing this.
 */
export function oauthBegin(integrationType: string): Promise<OAuthBeginResult> {
  return invoke<OAuthBeginResult>("oauth_begin", { integrationType });
}

/**
 * Phase 2 of the OAuth flow. Blocks until the provider redirects to
 * the loopback (default 5-minute window in the backend), then exchanges
 * the authorization code for an access token. Returns the raw token —
 * the caller pipes it through `saveToken` (preflight + persist).
 *
 * Errors:
 * - `"OAuth flow cancelled by user"` — user denied consent in the browser.
 * - `"OAuth state mismatch"` — CSRF defense triggered.
 * - `"OAuth flow timed out"` — no redirect arrived in 5 min.
 * - `"OAuth code-for-token exchange failed: <detail>"` — provider rejected the code.
 * - `"OAuth session not found"` — `sessionId` was never `oauth_begin`'d
 *   or has been consumed by a previous await.
 */
export function oauthAwait(sessionId: string): Promise<string> {
  return invoke<string>("oauth_await", { sessionId });
}

/**
 * Drop a parked OAuth session by `sessionId` without consuming it.
 * Releases the bound loopback port. Always succeeds — calling cancel
 * for an unknown id is a no-op.
 */
export function oauthCancel(sessionId: string): Promise<void> {
  return invoke<void>("oauth_cancel", { sessionId });
}
