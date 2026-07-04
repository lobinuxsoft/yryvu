// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource, createSignal } from "solid-js";

import {
  getUndoRedoState,
  getWorkingTreeStatus,
  type UndoRedoState,
  type WorkingTreeStatus,
} from "../ipc";
import { repoPath } from "./repo-base";

/// Self-echo suppression for the repo file watcher.
///
/// yryvu's own reads and writes churn the repo: a commit rewrites refs/index,
/// and — critically on atime-updating filesystems (e.g. NTFS/fuseblk, where
/// the user keeps repos) — a `git status` or graph walk stat-walks the whole
/// tree, which the watcher re-reports as changes. Left unchecked that is an
/// infinite loop: watcher fires → we refetch → the refetch's reads touch the
/// tree → watcher fires again.
///
/// So every app-initiated repo touch (local mutation refresh, working-tree
/// status fetch, graph stream) stamps `lastAppActivityAt`; the watcher
/// listeners (`state/repo-live.ts`) ignore events that land inside a
/// suppression window. When the app is idle, the window has expired and
/// genuinely external changes refresh immediately.
let lastAppActivityAt = 0;
export function markAppActivity() {
  lastAppActivityAt = performance.now();
}

/// True if the app touched the repo within the last `windowMs`.
export function appActiveWithin(windowMs: number): boolean {
  return performance.now() - lastAppActivityAt < windowMs;
}

/// Bumped whenever a staging-mutating op completes, so resources watching
/// working-tree status re-fetch.
export const [workingTreeNonce, setWorkingTreeNonce] = createSignal(0);
export function refreshWorkingTree() {
  markAppActivity();
  setWorkingTreeNonce((n) => n + 1);
}

/// Bumped after every undo / redo IPC so the toolbar's button-state
/// resource refetches and the buttons reflect the new cursor position.
/// Also bumped by graph / branches / working-tree refreshes so a user
/// committing through the toolbar sees Undo enable on the next tick.
export const [undoRedoNonce, setUndoRedoNonce] = createSignal(0);
export function refreshUndoRedo() {
  setUndoRedoNonce((n) => n + 1);
}

/// Bumped after any commit-creating op so CommitGraph re-streams.
export const [graphNonce, setGraphNonce] = createSignal(0);
export function refreshGraph() {
  markAppActivity();
  setGraphNonce((n) => n + 1);
}

/// Bumped after any ref-mutating op (branch create/rename/delete, tag
/// create, …) so the sidebar branch list and repo-state banner re-fetch.
export const [branchesNonce, setBranchesNonce] = createSignal(0);
export function refreshBranches() {
  markAppActivity();
  setBranchesNonce((n) => n + 1);
}

const [workingTreeStatusInternal, { mutate: mutateWorkingTreeStatus }] =
  createResource<WorkingTreeStatus | undefined, [string, number]>(
    () => {
      const p = repoPath();
      return p ? ([p, workingTreeNonce()] as [string, number]) : undefined;
    },
    async ([p]) => {
      // The status walk stat-touches the whole tree — arm the suppression
      // window so its own atime churn doesn't loop back through the watcher.
      markAppActivity();
      const status = await getWorkingTreeStatus(p);
      markAppActivity();
      return status;
    },
  );

export const workingTreeStatus = workingTreeStatusInternal;
export { mutateWorkingTreeStatus };

/// Toolbar Undo / Redo button state. Reads the per-repo sidecar via
/// `get_undo_redo_state` whenever:
///
///   - the repo path changes,
///   - `undoRedoNonce` bumps (an undo / redo just ran), OR
///   - any of the other refresh nonces bumps (a tracked op landed —
///     commit / checkout / reset / merge / stash all bump at least one
///     of `graphNonce`, `branchesNonce`, or `workingTreeNonce`).
///
/// Tracking the other nonces keeps the toolbar buttons honest without
/// having to thread an explicit `refreshUndoRedo` call through every
/// op handler. Refetches are cheap (single JSON read).
const [undoRedoStateInternal, undoRedoStateActions] = createResource<
  UndoRedoState | undefined,
  [string, number]
>(
  () => {
    const p = repoPath();
    if (!p) return undefined;
    // Compose all four nonces into a single key. Solid only refetches on
    // reference inequality, so a mutation that bumps any one of them
    // produces a new tuple identity and triggers the read.
    return [
      p,
      undoRedoNonce() + graphNonce() + branchesNonce() + workingTreeNonce(),
    ] as [string, number];
  },
  async ([p]) => await getUndoRedoState(p),
);

export const undoRedoState = undoRedoStateInternal;
export const mutateUndoRedoState = undoRedoStateActions.mutate;

export const dirtyFileCount = createMemo(() => {
  const s = workingTreeStatusInternal();
  if (!s) return 0;
  const paths = new Set<string>();
  s.unstaged.forEach((c) => paths.add(c.path));
  s.staged.forEach((c) => paths.add(c.path));
  return paths.size;
});
