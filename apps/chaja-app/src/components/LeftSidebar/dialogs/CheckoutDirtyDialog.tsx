// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

export function CheckoutDirtyDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const dialogState = () => {
    const d = ops.dialog();
    return d?.kind === "checkout-dirty" ? d : undefined;
  };
  const target = () => dialogState()?.target;
  const isRemoteTracking = () => dialogState()?.remoteTracking === true;

  return (
    <Dialog
      open={ops.dialog()?.kind === "checkout-dirty"}
      title="Uncommitted changes"
      onClose={ops.closeDialog}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={ops.closeDialog}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            onClick={() => {
              const t = target();
              if (!t) return;
              if (isRemoteTracking()) {
                void ops.stashAndCheckoutRemoteTracking(t);
              } else {
                void ops.stashAndCheckout(t);
              }
            }}
          >
            Stash & Checkout
          </button>
        </>
      }
    >
      <p>
        Your working tree has uncommitted changes. Stash them and switch to{" "}
        <code>{target()}</code>?
      </p>
      <p
        style={{
          color: "var(--fg-3)",
          "font-size": "12px",
          "margin-top": "8px",
        }}
      >
        You can restore the stash afterwards via the Stash section
        (coming with issue #12).
      </p>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
