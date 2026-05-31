// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  checkoutCommit,
  cherryPickCommits,
  createBranch,
  createTag,
  formatPatch,
  isWorkingTreeDirty,
  resetToCommit,
  revertCommit,
  stashPush,
  type ResetMode,
} from "../../ipc";
import {
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  selectedShas,
  stashByCommitSha,
} from "../../state";
import type { ContextMenuItem } from "../ContextMenu";
import { notify } from "../Notifications";
import { buildCommitMenuItems } from "./commitMenuItems";
import { buildStashMenuItems } from "./stashMenuItems";

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
  | { kind: "cherry-pick-onto"; shas: string[]; shortShas: string[] }
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

  /**
   * Open the "Cherry-pick onto…" branch picker. When the right-clicked
   * commit is part of the active multi-selection, the dialog operates on
   * the whole selection (youngest-first in state — reversed here to the
   * chronological order the backend expects, matching acceptance "Batch
   * picks apply in the original order" from issue #13). Otherwise it
   * operates on the single right-clicked sha.
   */
  function openCherryPickOntoDialog(sha: string) {
    const sel = selectedShas();
    const inSel = sel.includes(sha);
    const shas = inSel && sel.length > 1 ? sel.slice().reverse() : [sha];
    setDialogError(null);
    setDialog({
      kind: "cherry-pick-onto",
      shas,
      shortShas: shas.map((s) => s.slice(0, 7)),
    });
  }

  async function doCherryPickOnto(targetBranch: string) {
    const state = dialog();
    if (state?.kind !== "cherry-pick-onto") return;
    const path = repoPath();
    if (!path) return;
    try {
      await cherryPickCommits(path, state.shas, targetBranch);
      closeDialog();
      refreshGraph();
      refreshBranches();
      // Conflicts leave the working tree dirty with markers; clean
      // applies write a new commit and the WT stays clean — either way
      // the panel needs to refetch.
      refreshWorkingTree();
      const n = state.shas.length;
      notify.success(n > 1 ? `Cherry-picked ${n} commits` : "Cherry-picked", {
        message:
          n > 1
            ? `${state.shortShas[0]} … ${state.shortShas[n - 1]} → ${targetBranch}`
            : `${state.shortShas[0]} → ${targetBranch}`,
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
    // Stash nodes (issue #172) get a dedicated menu — Apply / Pop /
    // Drop / Copy SHA. The shared `branchOps/menus/stash` menu lives
    // behind a heavier `MenuDeps` surface (used by the sidebar with
    // its dialog stack); duplicating the four-action menu inline here
    // is cheaper than threading those deps through CommitGraph just
    // for one branch.
    const stashHit = stashByCommitSha().get(sha);
    if (stashHit) {
      setMenu({
        x: e.clientX,
        y: e.clientY,
        sha,
        shortSha,
        items: buildStashMenuItems(stashHit.info, stashHit.index, sha, copySha),
      });
      return;
    }
    const sel = selectedShas();
    const batchSize = sel.includes(sha) && sel.length > 1 ? sel.length : 0;
    const items = buildCommitMenuItems(sha, shortSha, batchSize, {
      tryCheckout,
      openCreateBranchDialog,
      openCreateTagDialog,
      doReset,
      openResetHardConfirm: (s, ss) => {
        setDialogError(null);
        setDialog({ kind: "reset-hard-confirm", sha: s, shortSha: ss });
      },
      openCherryPickOntoDialog,
      doRevert,
      doFormatPatch,
      copySha,
    });
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
    doCherryPickOnto,
  };
}

export type CommitOps = ReturnType<typeof createCommitOps>;
