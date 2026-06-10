// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { UserInfo } from "./credentials";

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
