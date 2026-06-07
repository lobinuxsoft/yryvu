// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { UserInfo } from "./credentials";
import type { Label } from "./pulls";

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
