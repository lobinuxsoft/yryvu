// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MergeResult } from "../../ipc";

export function parseRemoteBranchName(
  shortName: string,
): { remote: string; name: string } | null {
  const idx = shortName.indexOf("/");
  if (idx === -1) return null;
  return { remote: shortName.slice(0, idx), name: shortName.slice(idx + 1) };
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
