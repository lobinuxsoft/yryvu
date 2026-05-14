// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource } from "solid-js";

import {
  listBranches,
  stashCount,
  type BranchInfo,
} from "../../ipc";
import {
  branchesNonce,
  repoPath,
  workingTreeNonce,
} from "../../state";

/**
 * Loads the per-repo data the toolbar reads — current branch list (so
 * we can identify HEAD + read its ahead/behind/upstream) and the stash
 * queue depth (so the Pop button can disable on an empty queue).
 *
 * Branches use `branchesNonce` because every push / pull / fetch /
 * branch CRUD bumps it. Stash count uses `workingTreeNonce` because
 * stash push / pop / drop are working-tree mutations.
 */
export function useToolbarData() {
  const [branches] = createResource<BranchInfo[], [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as BranchInfo[];
      return await listBranches(path);
    },
  );

  const headBranch = createMemo<BranchInfo | undefined>(() =>
    branches()?.find((b) => b.is_head),
  );
  const aheadCount = () => headBranch()?.ahead ?? 0;
  const behindCount = () => headBranch()?.behind ?? 0;
  const upstreamShort = () => headBranch()?.upstream ?? undefined;
  const hasUpstream = () => upstreamShort() !== undefined;

  const [stashCountResource] = createResource<number, [string, number]>(
    () => [repoPath() ?? "", workingTreeNonce()] as [string, number],
    async ([path]) => {
      if (!path) return 0;
      return await stashCount(path);
    },
  );
  const stashEntries = () => stashCountResource() ?? 0;

  return {
    branches,
    headBranch,
    aheadCount,
    behindCount,
    upstreamShort,
    hasUpstream,
    stashEntries,
  };
}

export type ToolbarData = ReturnType<typeof useToolbarData>;
