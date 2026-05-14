// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource } from "solid-js";

import { resolveIssueTrackerPattern } from "../ipc";
import { preferences } from "./preferences";
import { repoPath } from "./repo-base";

/// Effective URL pattern for the active repo. Composes per-repo
/// override (`.git/config [yryvu] issueTrackerUrl`) + auto-detect from
/// origin + the global default — the resolution lives on the backend
/// (`resolve_issue_tracker_pattern` command) so the heuristics stay in
/// one place.
///
/// Refetches when `repoPath()` changes; `undefined` when no repo is
/// open (the resource source is `undefined`, so the fetcher never
/// runs).
const [issueTrackerPattern] = createResource<string | null, string>(
  () => repoPath(),
  async (path) => {
    try {
      return await resolveIssueTrackerPattern(path);
    } catch (err) {
      console.error("resolveIssueTrackerPattern failed:", err);
      return null;
    }
  },
);

export { issueTrackerPattern };

/// True when the user has enabled linkify in commit messages. Reads
/// the preferences resource; safe to call before preferences load
/// (returns `false`, so refs stay plain text during startup).
export const issueLinkifyEnabled = createMemo<boolean>(() => {
  const prefs = preferences();
  return prefs ? prefs.issueTracker.linkifyInCommits : false;
});
