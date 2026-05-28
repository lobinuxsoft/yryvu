// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Global stash list resource + sha→(stash, index) lookup memo.
 *
 * Wave 4 (issue #171) needs the commit graph's context menu to detect
 * stash rows by sha and dispatch into the shared stash menu in
 * `branchOps/menus/stash.tsx`. The sidebar already loads the list for
 * its STASHES section, but that resource lives in `useSidebarData`'s
 * closure — not reachable from `useCommitOps`. This module promotes
 * the fetch to the global state surface so both consumers share one
 * round-trip and refreshes ride the existing `branchesNonce` source
 * key (any ref / stash mutation already bumps it).
 */

import { createMemo, createResource } from "solid-js";

import { listStashes, type StashInfo } from "../ipc";

import { branchesNonce } from "./refresh";
import { repoPath } from "./repo-base";

const [stashesResource] = createResource<StashInfo[], [string, number]>(
  () => [repoPath() ?? "", branchesNonce()] as [string, number],
  async ([path]) => {
    if (!path) return [] as StashInfo[];
    try {
      return await listStashes(path);
    } catch {
      // Stash listing failures shouldn't crash the graph — fall back
      // to no-stashes-found rather than propagating. The toolbar's
      // stash count already surfaces hard failures via its own resource.
      return [] as StashInfo[];
    }
  },
  { initialValue: [] as StashInfo[] },
);

export const stashes = stashesResource;

/**
 * `Map<commit_sha, { info, index }>` keyed by the stash commit's sha
 * (the value `walk_commits` tags as `node_type === Stash`). `index` is
 * the LIFO position the stash IPCs operate on (0 = top of stack).
 *
 * Memoized — the per-row context menu opener does an O(1) lookup
 * without re-walking the array per click.
 */
export const stashByCommitSha = createMemo<
  Map<string, { info: StashInfo; index: number }>
>(() => {
  const list = stashes() ?? [];
  const out = new Map<string, { info: StashInfo; index: number }>();
  list.forEach((info, index) => {
    out.set(info.sha, { info, index });
  });
  return out;
});
