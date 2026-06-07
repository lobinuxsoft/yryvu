// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { UserInfo } from "./credentials";

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
