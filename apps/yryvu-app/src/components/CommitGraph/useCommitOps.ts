// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  checkoutCommit,
  cherryPickCommit,
  createBranch,
  createTag,
  formatPatch,
  isWorkingTreeDirty,
  resetToCommit,
  revertCommit,
  stashPush,
  type ResetMode,
} from "../../ipc";
import { refreshBranches, refreshGraph, refreshWorkingTree, repoPath } from "../../state";
import type { ContextMenuItem } from "../ContextMenu";
import { notify } from "../Notifications";

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
  | { kind: "reset-hard-confirm"; sha: string; shortSha: string }
  | { kind: "patch-saved"; path: string }
  | null;

export interface CommitOpsDeps {
  copyText: (text: string) => Promise<void>;
  pickSaveDir: () => Promise<string | null>;
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
    const shortSha = sha.slice(0, 7);
    try {
      await checkoutCommit(path, sha);
      closeDialog();
      refreshGraph();
      refreshBranches();
      refreshWorkingTree();
      notify.success("Checked out commit", {
        message: shortSha,
        category: "branch",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Checkout failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function stashAndCheckout(sha: string, shortSha: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await stashPush(path, `yryvu: auto-stash before checkout to ${shortSha}`);
      await checkoutCommit(path, sha);
      closeDialog();
      refreshGraph();
      refreshBranches();
      refreshWorkingTree();
      notify.success("Checked out commit", {
        message: `Auto-stashed → ${shortSha}`,
        category: "branch",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Checkout failed", {
        message: String(err),
        category: "branch",
      });
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
      notify.success("Branch created", {
        message: `${name} @ ${state.shortSha}`,
        category: "branch",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Create branch failed", {
        message: String(err),
        category: "branch",
      });
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
      notify.success("Tag created", {
        message: state.annotated ? `${name} (annotated)` : name,
        category: "repoObject",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Create tag failed", {
        message: String(err),
        category: "repoObject",
      });
    }
  }

  async function doReset(sha: string, mode: ResetMode) {
    const path = repoPath();
    if (!path) return;
    const shortSha = sha.slice(0, 7);
    try {
      await resetToCommit(path, sha, mode);
      closeDialog();
      refreshGraph();
      refreshBranches();
      // Soft reset puts the popped commits' tree changes in the index;
      // mixed puts them in the working tree; hard wipes both. All three
      // change what the WIP panel must show.
      refreshWorkingTree();
      notify.success(`Reset (${mode})`, {
        message: shortSha,
        category: "branch",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Reset failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function doCherryPick(sha: string) {
    const path = repoPath();
    if (!path) return;
    const shortSha = sha.slice(0, 7);
    try {
      await cherryPickCommit(path, sha);
      refreshGraph();
      refreshBranches();
      // Conflicts leave the working tree dirty with markers; clean
      // applies write a new commit and the WT stays clean — either way
      // the panel needs to refetch.
      refreshWorkingTree();
      notify.success("Cherry-picked", {
        message: shortSha,
        category: "commit",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Cherry-pick failed", {
        message: String(err),
        category: "commit",
      });
    }
  }

  async function doRevert(sha: string) {
    const path = repoPath();
    if (!path) return;
    const shortSha = sha.slice(0, 7);
    try {
      await revertCommit(path, sha);
      refreshGraph();
      refreshBranches();
      refreshWorkingTree();
      notify.success("Reverted", { message: shortSha, category: "commit" });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Revert failed", {
        message: String(err),
        category: "commit",
      });
    }
  }

  async function doFormatPatch(sha: string) {
    const path = repoPath();
    if (!path) return;
    try {
      const dir = await deps.pickSaveDir();
      if (!dir) return;
      const written = await formatPatch(path, sha, dir);
      setDialogError(null);
      setDialog({ kind: "patch-saved", path: written });
      notify.success("Patch saved", { message: written });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Format-patch failed", { message: String(err) });
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
        label: "Reset current branch here (soft)",
        onSelect: () => void doReset(sha, "soft"),
      },
      {
        label: "Reset current branch here (mixed)",
        onSelect: () => void doReset(sha, "mixed"),
      },
      {
        label: "Reset current branch here (hard)…",
        danger: true,
        onSelect: () => {
          setDialogError(null);
          setDialog({ kind: "reset-hard-confirm", sha, shortSha });
        },
      },
      { type: "separator" },
      {
        label: "Cherry-pick commit",
        onSelect: () => void doCherryPick(sha),
      },
      {
        label: "Revert commit",
        onSelect: () => void doRevert(sha),
      },
      { type: "separator" },
      {
        label: "Create patch from commit…",
        onSelect: () => void doFormatPatch(sha),
      },
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
    doReset,
  };
}

export type CommitOps = ReturnType<typeof createCommitOps>;
