// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { IssueDetail } from "./issues";

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
): Promise<import("../pr_detail").PullRequestDetail> {
  return invoke<import("../pr_detail").PullRequestDetail>(
    "integration_create_pr",
    {
      integrationType,
      owner,
      repo,
      input,
    },
  );
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
