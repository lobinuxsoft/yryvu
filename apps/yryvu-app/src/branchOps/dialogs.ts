// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RemoteInfo } from "../ipc";
import type { GitflowFlow } from "../components/LeftSidebar/types";
import type { BranchOpsState } from "./state";

/**
 * Pure-setter dialog openers. None of these touch the network — they
 * just seed the dialog signal + reset error/input fields. Async work
 * (submitCreate, submitMerge, …) lives in `handlers.ts`; this file
 * exists so the menu builders can import only the openers they need
 * without dragging the entire async surface in with them.
 */
export function createDialogOpeners(state: BranchOpsState) {
  const {
    setDialog,
    setDialogError,
    setDialogNameInput,
    setDialogPathInput,
    setMergeStrategy,
    setGitflowName,
    setGitflowTagMessage,
    setGitflowKeepBranch,
    setGitflowBase,
    setWorktreeCreateBranch,
    setWorktreeBase,
    setSubmoduleBranch,
    setSubmoduleName,
  } = state;

  function openCreateDialog(from?: string) {
    setDialogError(null);
    setDialogNameInput("");
    setDialog({ kind: "create", from });
  }

  function openRenameDialog(oldName: string) {
    setDialogError(null);
    setDialogNameInput(oldName);
    setDialog({ kind: "rename", oldName });
  }

  function openDeleteDialog(name: string) {
    setDialogError(null);
    setDialog({ kind: "delete", name });
  }

  function openMergePickDialog(source: string) {
    setDialogError(null);
    setMergeStrategy("fast-forward-or-merge");
    setDialog({ kind: "merge-pick", source });
  }

  function openDeleteRemoteDialog(remote: string, name: string) {
    setDialogError(null);
    setDialog({ kind: "delete-remote", remote, name });
  }

  function openSubmoduleAddDialog() {
    setDialogError(null);
    setDialogNameInput("");
    setDialogPathInput("");
    setSubmoduleBranch("");
    setSubmoduleName("");
    setDialog({ kind: "submodule-add" });
  }

  function openSubmoduleRemoveDialog(name: string, path: string) {
    setDialogError(null);
    setDialog({ kind: "submodule-remove", name, path });
  }

  function openSubmoduleResetDialog(name: string, dirty: boolean) {
    setDialogError(null);
    setDialog({ kind: "submodule-reset", name, dirty });
  }

  function openSubmoduleDeinitDialog(name: string, path: string, dirty: boolean) {
    setDialogError(null);
    setDialog({ kind: "submodule-deinit", name, path, dirty });
  }

  function openSetUpstreamDialog(
    branchName: string,
    currentUpstream: string | null,
  ) {
    setDialogError(null);
    setDialogNameInput(currentUpstream ?? "");
    setDialog({ kind: "set-upstream", branchName, currentUpstream });
  }

  function openDeleteTagDialog(
    name: string,
    scope:
      | { type: "local" }
      | { type: "remote"; remote: string }
      | { type: "all-remotes"; remotes: string[] },
  ) {
    setDialogError(null);
    setDialog({ kind: "delete-tag", name, scope });
  }

  function openAnnotateTagDialog(name: string) {
    setDialogError(null);
    setDialogNameInput("");
    setDialog({ kind: "annotate-tag", name });
  }

  function openAddRemoteDialog() {
    setDialogError(null);
    setDialogNameInput("");
    setDialogPathInput("");
    setDialog({ kind: "add-remote" });
  }

  /// The dialog owns its three fields locally (name / fetch / push) —
  /// there are more of them than the shared `dialogNameInput` +
  /// `dialogPathInput` pair can carry, and seeding them from the passed
  /// `RemoteInfo` keeps "what changed?" answerable at submit time.
  function openEditRemoteDialog(remote: RemoteInfo) {
    setDialogError(null);
    setDialog({ kind: "edit-remote", remote });
  }

  function openRemoveRemoteDialog(name: string) {
    setDialogError(null);
    setDialog({ kind: "remove-remote", name });
  }

  function openWorktreeAddDialog() {
    setDialogError(null);
    setDialogPathInput("");
    setDialogNameInput("");
    setWorktreeCreateBranch(true);
    setWorktreeBase("");
    setDialog({ kind: "worktree-add" });
  }

  function openWorktreeRemoveDialog(
    workdir: string,
    branch: string,
    dirty: boolean,
  ) {
    setDialogError(null);
    setDialog({ kind: "worktree-remove", workdir, branch, dirty });
  }

  function openGitflowStartDialog(flow: GitflowFlow, base = "") {
    setDialogError(null);
    setGitflowName("");
    setGitflowBase(base);
    setDialog({ kind: "gitflow-start", flow });
  }

  function openGitflowFinishDialog(
    flow: GitflowFlow,
    candidates: string[],
    base = "",
  ) {
    setDialogError(null);
    // Default selection: first candidate. Tag message empty (=>
    // lightweight). Keep-branch off (gitflow deletes by default).
    setGitflowName(candidates[0] ?? "");
    setGitflowTagMessage("");
    setGitflowKeepBranch(false);
    setGitflowBase(base);
    setDialog({ kind: "gitflow-finish", flow, candidates });
  }

  return {
    openWorktreeAddDialog,
    openWorktreeRemoveDialog,
    openGitflowStartDialog,
    openGitflowFinishDialog,
    openCreateDialog,
    openRenameDialog,
    openDeleteDialog,
    openMergePickDialog,
    openDeleteRemoteDialog,
    openSubmoduleAddDialog,
    openSubmoduleRemoveDialog,
    openSubmoduleResetDialog,
    openSubmoduleDeinitDialog,
    openSetUpstreamDialog,
    openDeleteTagDialog,
    openAnnotateTagDialog,
    openAddRemoteDialog,
    openEditRemoteDialog,
    openRemoveRemoteDialog,
  };
}

export type DialogOpeners = ReturnType<typeof createDialogOpeners>;
