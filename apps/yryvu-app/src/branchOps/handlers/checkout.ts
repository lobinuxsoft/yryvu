// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  checkoutBranch,
  checkoutCommit,
  checkoutRemoteTracking,
  isWorkingTreeDirty,
  stashPush,
} from "../../ipc";
import {
  maybeAutoUpdateSubmodules,
  refreshWorkingTree,
  repoPath,
} from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface CheckoutDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Checkout flow trio: `tryCheckout` is the entry — it dirty-checks first
 * and either escalates to the CheckoutDirty dialog or proceeds to
 * `doCheckout`. `stashAndCheckout` is the dialog's "stash + go" branch.
 */
export function createCheckoutHandlers(deps: CheckoutDeps) {
  const { state, refresh } = deps;
  const { setDialog, setDialogError, closeDialog } = state;

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
      refresh();
      refreshWorkingTree();
      notify.success("Checked out", { message: target, category: "branch" });
      void maybeAutoUpdateSubmodules(path);
    } catch (err) {
      setDialogError(String(err));
      notify.error("Checkout failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function stashAndCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await stashPush(path, `yryvu: auto-stash before checkout to ${target}`);
      await checkoutBranch(path, target);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Checked out", {
        message: `Auto-stashed → ${target}`,
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

  async function stashAndCheckoutRemoteTracking(fullRemoteName: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await stashPush(
        path,
        `yryvu: auto-stash before checkout to ${fullRemoteName}`,
      );
      await checkoutRemoteTracking(path, fullRemoteName);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Checked out", {
        message: `Auto-stashed → ${fullRemoteName}`,
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

  /**
   * Remote-branch checkout — creates-or-switches to a local tracking
   * branch (#222). Same dirty-tree guard as `tryCheckout`: dirty trees
   * escalate to the CheckoutDirty dialog, which then routes through
   * `doCheckoutRemoteTracking` once the user picks Stash & Switch /
   * Discard / Cancel.
   */
  async function tryCheckoutRemoteTracking(fullRemoteName: string) {
    const path = repoPath();
    if (!path) return;
    try {
      const dirty = await isWorkingTreeDirty(path);
      if (dirty) {
        setDialogError(null);
        setDialog({
          kind: "checkout-dirty",
          target: fullRemoteName,
          remoteTracking: true,
        });
        return;
      }
      await doCheckoutRemoteTracking(fullRemoteName);
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function doCheckoutRemoteTracking(fullRemoteName: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await checkoutRemoteTracking(path, fullRemoteName);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Checked out", {
        message: fullRemoteName,
        category: "branch",
      });
      void maybeAutoUpdateSubmodules(path);
    } catch (err) {
      setDialogError(String(err));
      notify.error("Checkout failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  /**
   * Tag checkout — detached HEAD on the tag's peeled commit. Dirty
   * trees surface the libgit2 "would overwrite" error as an inline
   * toast for now; the dirty-escalation dialog flow only covers
   * branch/remote checkout today (#223 follow-up).
   */
  async function tryCheckoutTagSha(tagName: string, sha: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await checkoutCommit(path, sha);
      refresh();
      refreshWorkingTree();
      notify.success("Checked out tag", {
        message: tagName,
        category: "branch",
      });
    } catch (err) {
      notify.error("Checkout tag failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  return {
    tryCheckout,
    doCheckout,
    stashAndCheckout,
    tryCheckoutRemoteTracking,
    doCheckoutRemoteTracking,
    stashAndCheckoutRemoteTracking,
    tryCheckoutTagSha,
  };
}
