// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkoutBranch, isWorkingTreeDirty, stashPush } from "../../ipc";
import { refreshWorkingTree, repoPath } from "../../state";
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
      notify.success("Checked out", { message: target });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Checkout failed", { message: String(err) });
    }
  }

  async function stashAndCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await stashPush(path, `chaja: auto-stash before checkout to ${target}`);
      await checkoutBranch(path, target);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Checked out", { message: `Auto-stashed → ${target}` });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Checkout failed", { message: String(err) });
    }
  }

  return { tryCheckout, doCheckout, stashAndCheckout };
}
