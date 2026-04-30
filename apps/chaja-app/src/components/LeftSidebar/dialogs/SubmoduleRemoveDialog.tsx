// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Confirms an end-to-end submodule removal. The backend shells out to
 * `git submodule deinit -f` + `git rm -f` + drops the cached gitdir,
 * which mutates the working tree irreversibly — the dialog exists so
 * the user has a chance to back out before the wipe.
 */
export function SubmoduleRemoveDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "submodule-remove" ? d : null;
  };

  return (
    <Dialog
      open={ops.dialog()?.kind === "submodule-remove"}
      title="Remove submodule"
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
            class="dialog__btn dialog__btn--danger"
            type="button"
            onClick={() => void ops.submitSubmoduleRemove()}
          >
            Remove
          </button>
        </>
      }
    >
      <p>
        Remove submodule <code>{state()?.name}</code> at{" "}
        <code>{state()?.path}</code>?
      </p>
      <p
        style={{
          "margin-top": "8px",
          color: "var(--fg-2)",
          "font-size": "12px",
        }}
      >
        Drops the working tree, the <code>.gitmodules</code> entry, and the
        cached gitdir under <code>.git/modules</code>. Stages the change — you
        still need to commit it.
      </p>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
