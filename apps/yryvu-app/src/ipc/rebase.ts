// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export type RebaseActionKind = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";

export type PauseReason = "edit" | "conflict";

export interface CommitSummary {
  oid: string;
  short_oid: string;
  summary: string;
  author_name: string;
  author_email: string;
}

export interface RebaseStep {
  oid: string;
  action: RebaseActionKind;
  new_message?: string | null;
}

export interface RebasePlan {
  onto: string;
  steps: RebaseStep[];
}

export interface RebaseState {
  onto: string;
  steps: RebaseStep[];
  current_step: number;
  original_head: string;
  head_branch: string | null;
  pause_reason: PauseReason | null;
}

export function listCommitsForRebase(repoPath: string, upstream: string) {
  return invoke<CommitSummary[]>("list_commits_for_rebase", { repoPath, upstream });
}

export function beginInteractiveRebase(repoPath: string, plan: RebasePlan) {
  return invoke<RebaseState>("begin_interactive_rebase", { repoPath, plan });
}

export function continueInteractiveRebase(repoPath: string) {
  return invoke<RebaseState>("continue_interactive_rebase", { repoPath });
}

export function skipInteractiveRebaseStep(repoPath: string) {
  return invoke<RebaseState>("skip_interactive_rebase_step", { repoPath });
}

export function abortInteractiveRebase(repoPath: string) {
  return invoke<void>("abort_interactive_rebase", { repoPath });
}

export function getInteractiveRebaseState(repoPath: string) {
  return invoke<RebaseState | null>("get_interactive_rebase_state", { repoPath });
}
