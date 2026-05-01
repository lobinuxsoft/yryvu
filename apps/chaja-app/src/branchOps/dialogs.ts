// SPDX-License-Identifier: AGPL-3.0-or-later

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

  return {
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
  };
}

export type DialogOpeners = ReturnType<typeof createDialogOpeners>;
