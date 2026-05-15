// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type {
  CiStatus,
  Label,
  PullRequestState,
  ReviewDecision,
  UserInfo,
} from "./integrationStorage";

/// GitLab project setting controlling how merges are committed.
/// Mirrors the backend `ProjectMergeMethod` enum (camelCase wire form).
export type ProjectMergeMethod = "merge" | "rebaseMerge" | "ff";

/// GitLab project setting controlling whether commits are squashed at
/// merge time. Mirrors the backend `ProjectSquashOption` enum.
export type ProjectSquashOption =
  | "never"
  | "always"
  | "defaultOff"
  | "defaultOn";

/// GitLab-only project merge config powering the merge form's
/// radio gating + squash checkbox availability. `null` for GitHub /
/// Gitea — the form falls back to unrestricted controls.
export interface ProjectMergeSettings {
  mergeMethod: ProjectMergeMethod;
  squashOption: ProjectSquashOption;
  removeSourceBranchAfterMergeDefault: boolean;
  allowMergeOnSkippedPipeline: boolean;
}

/**
 * Extended PR record — superset of `PullRequestSummary` with body
 * (markdown), mergeability, and aggregate counts. Powers the 4-tab
 * detail panel (#91).
 */
export interface PullRequestDetail {
  number: number;
  title: string;
  state: PullRequestState;
  draft: boolean;
  author: UserInfo;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  htmlUrl: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  body: string;
  labels: Label[];
  assignees: UserInfo[];
  requestedReviewers: UserInfo[];
  milestone: string | null;
  /// `true` = mergeable, `false` = conflicting, `null` = still computing.
  mergeable: boolean | null;
  /// Verbose verb: `clean | dirty | blocked | unstable | behind |
  /// has_hooks | unknown`. Drives Merge-button enablement.
  mergeableState: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: number;
  reviewDecision: ReviewDecision | null;
  ciStatus: CiStatus | null;
  /// GitLab-only project merge config; `null` for GitHub / Gitea.
  projectSettings: ProjectMergeSettings | null;
}

export interface PrCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: UserInfo;
  date: string;
}

export interface PrFile {
  filename: string;
  /// `added | modified | removed | renamed | copied | changed | unchanged`.
  status: string;
  additions: number;
  deletions: number;
  /// Unified-diff hunk text. `null` for binary files or when
  /// GitHub truncated past ~3MB.
  patch: string | null;
  /// Original filename when status === "renamed".
  previousFilename: string | null;
}

export interface CheckRun {
  name: string;
  /// `queued | in_progress | completed`.
  status: string;
  /// `success | failure | neutral | cancelled | skipped | timed_out |
  /// action_required`. `null` until status === "completed".
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export type PrActionVerb =
  | "close"
  | "reopen"
  | "convertToDraft"
  | "markReadyForReview";

/// Strategy GitHub applies when merging the PR. Matches the backend
/// `MergeMethod` enum verbatim (serialised lowercase).
export type MergeMethod = "merge" | "squash" | "rebase";

export function integrationGetPrDetail(
  integrationType: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestDetail> {
  return invoke<PullRequestDetail>("integration_get_pr_detail", {
    integrationType,
    owner,
    repo,
    number,
  });
}

export function integrationListPrCommits(
  integrationType: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PrCommit[]> {
  return invoke<PrCommit[]>("integration_list_pr_commits", {
    integrationType,
    owner,
    repo,
    number,
  });
}

export function integrationListPrFiles(
  integrationType: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PrFile[]> {
  return invoke<PrFile[]>("integration_list_pr_files", {
    integrationType,
    owner,
    repo,
    number,
  });
}

/// Fetch the Checks tab. GitHub uses `headSha` to look up
/// check-runs on the head commit; GitLab uses the MR `number` (iid)
/// to list pipelines. Pass both — providers ignore the irrelevant
/// argument, but each one is required by its own dispatch.
export function integrationListPrChecks(
  integrationType: string,
  owner: string,
  repo: string,
  headSha: string,
  number: number,
): Promise<CheckRun[]> {
  return invoke<CheckRun[]>("integration_list_pr_checks", {
    integrationType,
    owner,
    repo,
    number,
    headSha,
  });
}

export function integrationPrAction(
  integrationType: string,
  owner: string,
  repo: string,
  number: number,
  action: PrActionVerb,
): Promise<PullRequestDetail> {
  return invoke<PullRequestDetail>("integration_pr_action", {
    integrationType,
    owner,
    repo,
    number,
    action,
  });
}

/// Merge a PR via the matching provider's API. On success, optionally
/// drops the source branch (GitHub: separate `DELETE /git/refs`;
/// GitLab: `should_remove_source_branch` in the merge body). Returns
/// the post-mutation detail so the panel refreshes in one round-trip.
///
/// `squash` is GitLab-only: the GitLab API exposes squash as a flag
/// independent of merge method, so the form can offer "merge with merge
/// commit but squash all commits" combos. GitHub + Gitea derive squash
/// from `method === "squash"`.
export interface MergeOptions {
  method: MergeMethod;
  commitTitle?: string;
  commitMessage?: string;
  deleteSourceBranch: boolean;
  /// GitLab-only squash override. `undefined` = backend defaults
  /// (squash iff `method === "squash"`).
  squash?: boolean;
}

export function integrationMergePr(
  integrationType: string,
  owner: string,
  repo: string,
  number: number,
  options: MergeOptions,
): Promise<PullRequestDetail> {
  return invoke<PullRequestDetail>("integration_merge_pr", {
    integrationType,
    owner,
    repo,
    number,
    method: options.method,
    commitTitle: options.commitTitle ?? null,
    commitMessage: options.commitMessage ?? null,
    deleteSourceBranch: options.deleteSourceBranch,
    squash: options.squash ?? null,
  });
}

/// Rebase a GitLab MR's source branch onto target via
/// `PUT /merge_requests/:iid/rebase`. `skipCi` suppresses the pipeline
/// trigger that would otherwise fire on the rebased commits.
/// GitLab-only — calling against GitHub / Gitea returns an error from
/// the backend.
export function integrationRebaseMr(
  integrationType: string,
  owner: string,
  repo: string,
  number: number,
  skipCi: boolean,
): Promise<PullRequestDetail> {
  return invoke<PullRequestDetail>("integration_rebase_mr", {
    integrationType,
    owner,
    repo,
    number,
    skipCi,
  });
}
