// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  abortMerge,
  checkoutBranch,
  createBranch,
  deleteLocalBranch,
  deleteRemoteBranch,
  fetchPrune,
  isWorkingTreeDirty,
  mergeBranch,
  renameBranch,
  stashPush,
  type BranchInfo,
  type MergeStrategy,
} from "../../ipc";
import { repoPath } from "../../state";
import type { ContextMenuItem } from "../ContextMenu";
import { parseRemoteBranchName } from "./helpers";
import type { DialogState, MenuState } from "./types";

export interface BranchOpsDeps {
  refresh: () => void;
}

export function createBranchOps(deps: BranchOpsDeps) {
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [dialog, setDialog] = createSignal<DialogState>(null);
  const [dialogError, setDialogError] = createSignal<string | null>(null);
  const [dialogNameInput, setDialogNameInput] = createSignal("");
  const [mergeStrategy, setMergeStrategy] =
    createSignal<MergeStrategy>("fast-forward-or-merge");
  const [refreshingRemote, setRefreshingRemote] = createSignal(false);

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

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

  async function tryCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      const dirty = await isWorkingTreeDirty(path);
      if (dirty) {
        setDialogError(null);
        setDialog({ kind: "checkout-dirty", target });
        return;
      }
      await doCheckout(target);
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function doCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await checkoutBranch(path, target);
      closeDialog();
      deps.refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function stashAndCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await stashPush(path, `chaja: auto-stash before checkout to ${target}`);
      await checkoutBranch(path, target);
      closeDialog();
      deps.refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitMerge() {
    const state = dialog();
    if (state?.kind !== "merge-pick") return;
    const path = repoPath();
    if (!path) return;
    try {
      const result = await mergeBranch(path, state.source, mergeStrategy());
      setDialog({ kind: "merge-result", result });
      deps.refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitDeleteRemote() {
    const state = dialog();
    if (state?.kind !== "delete-remote") return;
    const path = repoPath();
    if (!path) return;
    try {
      await deleteRemoteBranch(path, state.remote, state.name);
      closeDialog();
      deps.refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function doAbortMerge() {
    const path = repoPath();
    if (!path) return;
    try {
      await abortMerge(path);
      closeDialog();
      deps.refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitCreate() {
    const state = dialog();
    if (state?.kind !== "create") return;
    const path = repoPath();
    const name = dialogNameInput().trim();
    if (!path || !name) return;
    try {
      await createBranch(path, name, state.from);
      closeDialog();
      deps.refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitRename() {
    const state = dialog();
    if (state?.kind !== "rename") return;
    const path = repoPath();
    const newName = dialogNameInput().trim();
    if (!path || !newName || newName === state.oldName) {
      closeDialog();
      return;
    }
    try {
      await renameBranch(path, state.oldName, newName);
      closeDialog();
      deps.refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitDelete(force: boolean) {
    const state = dialog();
    if (state?.kind !== "delete") return;
    const path = repoPath();
    if (!path) return;
    try {
      await deleteLocalBranch(path, state.name, force);
      closeDialog();
      deps.refresh();
    } catch (err) {
      const msg = String(err);
      if (!force && msg.includes("not fully merged")) {
        setDialog({ kind: "delete", name: state.name, unmerged: true });
        setDialogError(null);
        return;
      }
      setDialogError(msg);
    }
  }

  async function refreshRemote() {
    const path = repoPath();
    if (!path || refreshingRemote()) return;
    setRefreshingRemote(true);
    try {
      await fetchPrune(path);
      deps.refresh();
    } catch (err) {
      setDialogError(`Refresh failed: ${String(err)}`);
    } finally {
      setRefreshingRemote(false);
    }
  }

  function openBranchContextMenu(e: MouseEvent, b: BranchInfo) {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: "Checkout",
        disabled: b.is_head,
        onSelect: () => void tryCheckout(b.name),
      },
      {
        label: `Merge '${b.name}' into current`,
        disabled: b.is_head,
        onSelect: () => openMergePickDialog(b.name),
      },
      { type: "separator" },
      {
        label: "Create branch here",
        onSelect: () => openCreateDialog(b.tip_sha),
      },
      {
        label: `Rename '${b.name}'…`,
        onSelect: () => openRenameDialog(b.name),
      },
      {
        label: `Delete '${b.name}'…`,
        danger: true,
        disabled: b.is_head,
        onSelect: () => openDeleteDialog(b.name),
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function openRemoteContextMenu(e: MouseEvent, b: BranchInfo) {
    e.preventDefault();
    const parsed = parseRemoteBranchName(b.name);
    const items: ContextMenuItem[] = [
      {
        label: `Merge '${b.name}' into current`,
        onSelect: () => openMergePickDialog(b.name),
      },
      { type: "separator" },
      {
        label: "Create branch here",
        onSelect: () => openCreateDialog(b.tip_sha),
      },
      {
        label: `Delete remote '${b.name}'…`,
        danger: true,
        disabled: !parsed,
        onSelect: () =>
          parsed && openDeleteRemoteDialog(parsed.remote, parsed.name),
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  return {
    // state
    menu,
    setMenu,
    dialog,
    dialogError,
    dialogNameInput,
    setDialogNameInput,
    mergeStrategy,
    setMergeStrategy,
    refreshingRemote,
    // dialog openers / closers
    openCreateDialog,
    openRenameDialog,
    openDeleteDialog,
    openMergePickDialog,
    openDeleteRemoteDialog,
    closeDialog,
    // context menu
    openBranchContextMenu,
    openRemoteContextMenu,
    // async operations
    tryCheckout,
    stashAndCheckout,
    submitCreate,
    submitRename,
    submitDelete,
    submitMerge,
    submitDeleteRemote,
    doAbortMerge,
    refreshRemote,
  };
}

export type BranchOps = ReturnType<typeof createBranchOps>;
