// SPDX-License-Identifier: AGPL-3.0-or-later

import { worktreeAdd, worktreePrune, worktreeRemove } from "../../ipc";
import { refreshBranches, refreshWorkingTree, repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface WorktreeHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Worktree management submitters (issue #20): add (new or existing
 * branch), confirm-remove, and prune. All bump branchesNonce +
 * workingTreeNonce — adding/removing a worktree changes the worktree
 * list (keyed on branchesNonce) and may create a branch.
 */
export function createWorktreeHandlers(deps: WorktreeHandlersDeps) {
  const { state } = deps;
  const {
    dialog,
    closeDialog,
    setDialogError,
    dialogPathInput,
    dialogNameInput,
    worktreeCreateBranch,
    worktreeBase,
  } = state;

  async function submitWorktreeAdd() {
    if (dialog()?.kind !== "worktree-add") return;
    const repo = repoPath();
    const path = dialogPathInput().trim();
    const branch = dialogNameInput().trim();
    if (!repo || !path || !branch) return;
    const create = worktreeCreateBranch();
    const base = create ? worktreeBase().trim() || null : null;
    try {
      await worktreeAdd(repo, path, branch, base, create);
      closeDialog();
      refreshBranches();
      refreshWorkingTree();
      notify.success("Worktree added", { message: path, category: "repoObject" });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Add worktree failed", {
        message: String(err),
        category: "repoObject",
      });
    }
  }

  async function submitWorktreeRemove() {
    const s = dialog();
    if (s?.kind !== "worktree-remove") return;
    const repo = repoPath();
    if (!repo) return;
    try {
      await worktreeRemove(repo, s.workdir);
      closeDialog();
      refreshBranches();
      refreshWorkingTree();
      notify.info("Worktree removed", {
        message: s.workdir,
        category: "repoObject",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Remove failed", {
        message: String(err),
        category: "repoObject",
      });
    }
  }

  async function doWorktreePrune() {
    const repo = repoPath();
    if (!repo) return;
    try {
      const pruned = await worktreePrune(repo);
      refreshBranches();
      notify.info(
        pruned === 0 ? "No prunable worktrees" : `Pruned ${pruned} worktree(s)`,
        { category: "repoObject" },
      );
    } catch (err) {
      notify.error("Prune failed", {
        message: String(err),
        category: "repoObject",
      });
    }
  }

  return { submitWorktreeAdd, submitWorktreeRemove, doWorktreePrune };
}
