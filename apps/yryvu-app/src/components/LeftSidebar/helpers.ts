// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BranchInfo, MergeResult } from "../../ipc";

export function parseRemoteBranchName(
  shortName: string,
): { remote: string; name: string } | null {
  const idx = shortName.indexOf("/");
  if (idx === -1) return null;
  return { remote: shortName.slice(0, idx), name: shortName.slice(idx + 1) };
}

export interface RemoteGroup {
  remote: string;
  branches: BranchInfo[];
}

/**
 * Group remote-tracking branches under their configured remote for the
 * two-level REMOTE section (#239). Folder semantics mirror GK (audit
 * doc 03):
 *
 *   - No filter: every configured remote gets a folder row, including
 *     remotes with zero tracking refs (a freshly-added remote must be
 *     visible before its first fetch).
 *   - Filtering: a query matching the remote's name keeps the folder
 *     with ALL its branches; otherwise only matching branches are
 *     kept, and folders left empty disappear (GK hides empty remotes
 *     mid-filter).
 *
 * Branches whose `remote/` prefix doesn't match any configured remote
 * are dropped — `git remote remove` prunes `refs/remotes/<r>/*`, so
 * orphans only exist transiently.
 */
export function groupRemoteBranches(
  remoteNames: string[],
  branches: BranchInfo[],
  query: string,
): RemoteGroup[] {
  const q = query.toLowerCase();
  const groups = remoteNames.map((remote) => {
    const prefix = `${remote}/`;
    const members = branches.filter((b) => b.name.startsWith(prefix));
    if (q === "" || remote.toLowerCase().includes(q)) {
      return { remote, branches: members };
    }
    return {
      remote,
      branches: members.filter((b) => b.name.toLowerCase().includes(q)),
    };
  });
  if (q === "") return groups;
  return groups.filter(
    (g) => g.branches.length > 0 || g.remote.toLowerCase().includes(q),
  );
}

export function mergeResultTitle(result?: MergeResult): string {
  if (!result) return "Merge";
  switch (result.kind) {
    case "already-up-to-date":
      return "Already up to date";
    case "fast-forward":
      return "Fast-forwarded";
    case "merged":
      return "Merge commit created";
    case "conflict":
      return "Merge conflict";
  }
}

export function stateBannerTitle(kind: string): string {
  switch (kind) {
    case "merge":
      return "Merge in progress";
    case "rebase":
      return "Rebase in progress";
    case "cherry-pick":
      return "Cherry-pick in progress";
    case "revert":
      return "Revert in progress";
    case "bisect":
      return "Bisect in progress";
    case "apply-mailbox":
      return "Patch application in progress";
    default:
      return `${kind} in progress`;
  }
}
