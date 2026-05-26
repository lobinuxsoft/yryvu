// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared `RepoStateInfo` resource — was previously private to
 * `useSidebarData`, now hoisted so the commit-graph overlays (issue
 * #53) can read `conflict_paths` for the WIP-row conflict indicator
 * without re-fetching.
 *
 * Refetches whenever the branches nonce bumps (any ref-mutating op:
 * commit / checkout / merge / etc.). Initial value mirrors the
 * "clean" steady state so consumers don't need to gate on `loading`.
 */

import { createResource } from "solid-js";

import { getRepoState, type RepoStateInfo } from "../ipc";

import { branchesNonce } from "./refresh";
import { repoPath } from "./repo-base";

export const [repoState] = createResource<RepoStateInfo, [string, number]>(
  () => [repoPath() ?? "", branchesNonce()] as [string, number],
  async ([path]) => {
    if (!path) return { kind: "clean", conflict_paths: [] };
    return await getRepoState(path);
  },
  { initialValue: { kind: "clean", conflict_paths: [] } },
);

export const hasConflicts = () => (repoState()?.conflict_paths.length ?? 0) > 0;
