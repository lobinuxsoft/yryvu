// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  checkoutCommit,
  createBranch,
  createTag,
  isWorkingTreeDirty,
  stashPush,
} from "../../ipc";
import { refreshBranches, refreshGraph, repoPath } from "../../state";
import type { ContextMenuItem } from "../ContextMenu";

export type CommitMenuState = {
  x: number;
  y: number;
  sha: string;
  shortSha: string;
  items: ContextMenuItem[];
};

export type CommitDialogState =
  | { kind: "create-branch"; sha: string; shortSha: string }
  | { kind: "create-tag"; sha: string; shortSha: string; annotated: boolean }
  | { kind: "checkout-dirty"; sha: string; shortSha: string }
  | null;

export interface CommitOpsDeps {
  copyText: (text: string) => Promise<void>;
}

export function createCommitOps(deps: CommitOpsDeps) {
  const [menu, setMenu] = createSignal<CommitMenuState | null>(null);
  const [dialog, setDialog] = createSignal<CommitDialogState>(null);
  const [dialogError, setDialogError] = createSignal<string | null>(null);
  const [nameInput, setNameInput] = createSignal("");
  const [messageInput, setMessageInput] = createSignal("");

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
    setNameInput("");
    setMessageInput("");
  }

  function openCreateBranchDialog(sha: string, shortSha: string) {
    setDialogError(null);
    setNameInput("");
    setDialog({ kind: "create-branch", sha, shortSha });
  }

  function openCreateTagDialog(sha: string, shortSha: string, annotated: boolean) {
    setDialogError(null);
    setNameInput("");
    setMessageInput("");
    setDialog({ kind: "create-tag", sha, shortSha, annotated });
  }

  async function copySha(sha: string) {
    try {
      await deps.copyText(sha);
    } catch {
      // Clipboard failures are non-fatal; the user can always read the SHA
      // from the inspector. No toast system exists yet to surface this.
    }
  }

  async function tryCheckout(sha: string, shortSha: string) {
    const path = repoPath();
    if (!path) return;
    try {
      const dirty = await isWorkingTreeDirty(path);
      if (dirty) {
        setDialogError(null);
        setDialog({ kind: "checkout-dirty", sha, shortSha });
        return;
      }
      await doCheckout(sha);
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function doCheckout(sha: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await checkoutCommit(path, sha);
      closeDialog();
      refreshGraph();
      refreshBranches();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function stashAndCheckout(sha: string, shortSha: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await stashPush(path, `chaja: auto-stash before checkout to ${shortSha}`);
      await checkoutCommit(path, sha);
      closeDialog();
      refreshGraph();
      refreshBranches();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitCreateBranch() {
    const state = dialog();
    if (state?.kind !== "create-branch") return;
    const path = repoPath();
    const name = nameInput().trim();
    if (!path || !name) return;
    try {
      await createBranch(path, name, state.sha);
      closeDialog();
      refreshGraph();
      refreshBranches();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitCreateTag() {
    const state = dialog();
    if (state?.kind !== "create-tag") return;
    const path = repoPath();
    const name = nameInput().trim();
    if (!path || !name) return;
    const message = state.annotated ? messageInput().trim() : "";
    if (state.annotated && !message) return;
    try {
      await createTag(path, name, state.sha, state.annotated ? message : null);
      closeDialog();
      refreshGraph();
      refreshBranches();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  function openCommitContextMenu(e: MouseEvent, sha: string, shortSha: string) {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: "Checkout this commit",
        onSelect: () => void tryCheckout(sha, shortSha),
      },
      { type: "separator" },
      {
        label: "Create branch here…",
        onSelect: () => openCreateBranchDialog(sha, shortSha),
      },
      {
        label: "Create tag here…",
        onSelect: () => openCreateTagDialog(sha, shortSha, false),
      },
      {
        label: "Create annotated tag here…",
        onSelect: () => openCreateTagDialog(sha, shortSha, true),
      },
      { type: "separator" },
      {
        label: "Copy commit SHA",
        onSelect: () => void copySha(sha),
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, sha, shortSha, items });
  }

  return {
    // state
    menu,
    setMenu,
    dialog,
    dialogError,
    nameInput,
    setNameInput,
    messageInput,
    setMessageInput,
    // openers
    openCommitContextMenu,
    closeDialog,
    // async ops
    stashAndCheckout,
    submitCreateBranch,
    submitCreateTag,
  };
}

export type CommitOps = ReturnType<typeof createCommitOps>;
