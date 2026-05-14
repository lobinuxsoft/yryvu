// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Read the per-repo override `[yryvu] issueTrackerUrl` from the
/// repository's local `.git/config`. Returns `null` when the key is
/// absent — most repos start without an override and inherit the
/// global default (or the auto-detected pattern).
export function getRepoIssueTrackerUrl(repoPath: string): Promise<string | null> {
  return invoke<string | null>("get_repo_issue_tracker_url", { repoPath });
}

/// Write the per-repo override. Pass `null` to remove the key (the
/// resolver then falls back to auto-detect / global default).
export function setRepoIssueTrackerUrl(
  repoPath: string,
  value: string | null,
): Promise<void> {
  return invoke<void>("set_repo_issue_tracker_url", { repoPath, value });
}

/// Resolve the effective URL pattern for the given repo. Composes the
/// per-repo override (if set), the auto-detected provider pattern (if
/// auto-detect is enabled in preferences), and the global default —
/// in that order. Returns `null` when nothing resolves; the linkifier
/// renders refs as plain text in that case.
export function resolveIssueTrackerPattern(
  repoPath: string,
): Promise<string | null> {
  return invoke<string | null>("resolve_issue_tracker_pattern", { repoPath });
}
