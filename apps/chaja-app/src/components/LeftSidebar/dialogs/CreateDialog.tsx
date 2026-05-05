// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

export function CreateDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const from = () =>
    ops.dialog()?.kind === "create"
      ? (ops.dialog() as { from?: string }).from
      : undefined;

  return (
    <Dialog
      open={ops.dialog()?.kind === "create"}
      title={from() ? "Create branch from commit" : "Create branch"}
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
            disabled={!ops.dialogNameInput().trim()}
            onClick={ops.submitCreate}
          >
            Create
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="create-branch-name">Branch name</label>
        <input
          id="create-branch-name"
          type="text"
          value={ops.dialogNameInput()}
          placeholder="my-new-branch"
          onInput={(e) => ops.setDialogNameInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ops.submitCreate();
          }}
        />
      </div>
      <Show when={from()}>
        <p
          class="dialog__field"
          style={{
            "margin-top": "8px",
            color: "var(--fg-2)",
            "font-size": "12px",
          }}
        >
          From: <code>{from()?.slice(0, 7)}</code>
        </p>
      </Show>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
