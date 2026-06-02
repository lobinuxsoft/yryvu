// SPDX-License-Identifier: AGPL-3.0-or-later

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
    setDialog({ kind: "submodule-add" });
  }

  function openSubmoduleRemoveDialog(name: string, path: string) {
    setDialogError(null);
    setDialog({ kind: "submodule-remove", name, path });
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

  function openEditRemoteDialog(name: string, currentUrl: string) {
    setDialogError(null);
    // Single-input dialog — repurpose dialogNameInput for the URL so we
    // can reuse the existing input plumbing without a third signal.
    setDialogNameInput(currentUrl);
    setDialog({ kind: "edit-remote", name });
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
    openSetUpstreamDialog,
    openDeleteTagDialog,
    openAnnotateTagDialog,
    openAddRemoteDialog,
    openEditRemoteDialog,
    openRemoveRemoteDialog,
  };
}

export type DialogOpeners = ReturnType<typeof createDialogOpeners>;
