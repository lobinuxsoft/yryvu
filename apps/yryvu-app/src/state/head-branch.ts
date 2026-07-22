// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared "which branch is HEAD on" accessor.
 *
 * The commit panel's header renders `{N} file changes on <branch>` and
 * needs the head branch's short name — GitKraken's `RightPanel-NChangesOn`
 * followed by a graph-column-tinted pill (bundle offset 3478440). Every
 * existing consumer of `listBranches` (toolbar, sidebar, create-PR dialog,
 * cherry-pick dialog) builds its own closure-scoped resource, so there was
 * nothing to read from. This promotes just the head lookup to the global
 * state surface, same shape as `stashes` — one resource keyed on
 * `[repoPath, branchesNonce]`, which every ref mutation already bumps.
 */

import { createMemo, createResource } from "solid-js";

import { listBranches, type BranchInfo } from "../ipc";

import { branchesNonce } from "./refresh";
import { repoPath } from "./repo-base";

const [branchesResource] = createResource<BranchInfo[], [string, number]>(
  () => [repoPath() ?? "", branchesNonce()] as [string, number],
  async ([path]) => {
    if (!path) return [] as BranchInfo[];
    try {
      return await listBranches(path);
    } catch {
      // A header that can't name the branch degrades to "in working
      // directory"; it must never take the panel down with it.
      return [] as BranchInfo[];
    }
  },
  { initialValue: [] as BranchInfo[] },
);

/// The checked-out branch, or `undefined` on a detached HEAD / unborn
/// branch / failed listing.
export const headBranch = createMemo<BranchInfo | undefined>(() =>
  branchesResource().find((b) => b.is_head),
);

export const headBranchName = (): string | undefined => headBranch()?.name;
