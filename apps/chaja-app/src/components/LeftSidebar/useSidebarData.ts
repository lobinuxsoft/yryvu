// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, type Accessor } from "solid-js";

import {
  getRepoState,
  listBranches,
  listStashes,
  listSubmodules,
  listTags,
  listWorktrees,
  type BranchInfo,
  type RepoStateInfo,
  type StashInfo,
  type SubmoduleInfo,
  type TagInfo,
  type WorktreeInfo,
} from "../../ipc";
import { branchesNonce, repoPath, workingTreeNonce } from "../../state";

const matches = (name: string, q: string) =>
  q === "" || name.toLowerCase().includes(q.toLowerCase());

/**
 * Loads every resource the sidebar renders (branches / repo state /
 * tags / worktrees / stashes / submodules) and exposes the raw +
 * filtered slices keyed off the current filter query. Lives in its own
 * file so the component file is JSX, not bookkeeping.
 *
 * Refresh policy:
 *   - branches / repoState / tags / worktrees / submodules listen to
 *     `branchesNonce` since every ref-mutating op bumps it.
 *   - stashes listen to `workingTreeNonce` (stash push/pop/drop are
 *     working-tree mutations, not ref ops).
 *   - submodules also listen to `workingTreeNonce` — parent commits
 *     advancing the pinned SHA shows up there.
 */
export function useSidebarData(filterQuery: Accessor<string>) {
  const [branches] = createResource<BranchInfo[], [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as BranchInfo[];
      return await listBranches(path);
    },
    { initialValue: [] },
  );

  const [repoState] = createResource<RepoStateInfo, [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return { kind: "clean", conflict_paths: [] };
      return await getRepoState(path);
    },
    { initialValue: { kind: "clean", conflict_paths: [] } },
  );

  // Tags share the same `branchesNonce` source-key as branches so any
  // ref-mutating op (including `createTag` via `useCommitOps`) refreshes
  // the list without a dedicated tagsNonce.
  const [tags] = createResource<TagInfo[], [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as TagInfo[];
      return await listTags(path);
    },
    { initialValue: [] },
  );

  // Worktrees use branchesNonce too — checking out a branch in another
  // worktree, removing one, or adding one all flow through ref-mutating
  // ops that bump the nonce. No dedicated worktreesNonce needed.
  const [worktrees] = createResource<WorktreeInfo[], [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as WorktreeInfo[];
      return await listWorktrees(path);
    },
    { initialValue: [] },
  );

  // Stashes are working-tree mutations (push/pop/drop) — workingTreeNonce
  // is the right source-key. Refs aren't involved unless the stash is
  // saved with a branch_name (informational only).
  const [stashes] = createResource<StashInfo[], [string, number]>(
    () => [repoPath() ?? "", workingTreeNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as StashInfo[];
      return await listStashes(path);
    },
    { initialValue: [] },
  );

  // Submodules can shift on init/deinit/update, AND on parent commits
  // changing the pinned SHA. Both source signals matter.
  const [submodules] = createResource<
    SubmoduleInfo[],
    [string, number, number]
  >(
    () =>
      [repoPath() ?? "", branchesNonce(), workingTreeNonce()] as [
        string,
        number,
        number,
      ],
    async ([path]) => {
      if (!path) return [] as SubmoduleInfo[];
      return await listSubmodules(path);
    },
    { initialValue: [] },
  );

  const locals = () => (branches() ?? []).filter((b) => b.kind === "local");
  const remotes = () => (branches() ?? []).filter((b) => b.kind === "remote");
  const tagList = () => tags() ?? [];
  const worktreeList = () => worktrees() ?? [];
  const stashList = () => stashes() ?? [];
  const submoduleList = () => submodules() ?? [];
  const filteredLocals = () =>
    locals().filter((b) => matches(b.name, filterQuery()));
  const filteredRemotes = () =>
    remotes().filter((b) => matches(b.name, filterQuery()));
  const filteredTags = () =>
    tagList().filter((t) => matches(t.name, filterQuery()));
  // Filter worktrees by branch name OR path tail — both are searchable signals.
  const filteredWorktrees = () =>
    worktreeList().filter(
      (w) =>
        matches(w.branch, filterQuery()) || matches(w.workdir, filterQuery()),
    );
  // Stashes filter by message OR branch_name — branch is what users
  // remember when looking for a stash they took on a feature branch.
  const filteredStashes = () =>
    stashList().filter(
      (s) =>
        matches(s.message, filterQuery()) ||
        matches(s.branch_name ?? "", filterQuery()),
    );
  // Submodules filter on name and path — both are user-facing strings.
  const filteredSubmodules = () =>
    submoduleList().filter(
      (s) => matches(s.name, filterQuery()) || matches(s.path, filterQuery()),
    );
  const isFiltering = () => filterQuery() !== "";
  const totalMatches = () =>
    isFiltering()
      ? filteredLocals().length +
        filteredRemotes().length +
        filteredTags().length +
        filteredWorktrees().length +
        filteredStashes().length +
        filteredSubmodules().length
      : -1;

  return {
    branches,
    repoState,
    tags,
    locals,
    remotes,
    tagList,
    worktreeList,
    stashList,
    submoduleList,
    filteredLocals,
    filteredRemotes,
    filteredTags,
    filteredWorktrees,
    filteredStashes,
    filteredSubmodules,
    isFiltering,
    totalMatches,
  };
}

export type SidebarData = ReturnType<typeof useSidebarData>;
