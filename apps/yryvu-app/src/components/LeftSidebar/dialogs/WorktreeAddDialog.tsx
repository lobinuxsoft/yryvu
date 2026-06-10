// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

export function WorktreeAddDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const open = () => ops.dialog()?.kind === "worktree-add";
  const create = () => ops.worktreeCreateBranch();
  const canSubmit = () =>
    !!ops.dialogPathInput().trim() && !!ops.dialogNameInput().trim();

  return (
    <Dialog
      open={open()}
      title="Add worktree"
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
            disabled={!canSubmit()}
            onClick={ops.submitWorktreeAdd}
          >
            Add
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="worktree-path">Path</label>
        <input
          id="worktree-path"
          type="text"
          value={ops.dialogPathInput()}
          placeholder="/path/to/new-worktree"
          onInput={(e) => ops.setDialogPathInput(e.currentTarget.value)}
        />
      </div>

      <label class="dialog__field" style={{ "flex-direction": "row", gap: "8px" }}>
        <input
          type="checkbox"
          checked={create()}
          onChange={(e) => ops.setWorktreeCreateBranch(e.currentTarget.checked)}
        />
        Create a new branch
      </label>

      <div class="dialog__field">
        <label for="worktree-branch">
          {create() ? "New branch name" : "Existing branch"}
        </label>
        <input
          id="worktree-branch"
          type="text"
          value={ops.dialogNameInput()}
          placeholder={create() ? "feature/x" : "existing-branch"}
          onInput={(e) => ops.setDialogNameInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit()) ops.submitWorktreeAdd();
          }}
        />
      </div>

      <Show when={create()}>
        <div class="dialog__field">
          <label for="worktree-base">Base (optional)</label>
          <input
            id="worktree-base"
            type="text"
            value={ops.worktreeBase()}
            placeholder="HEAD"
            onInput={(e) => ops.setWorktreeBase(e.currentTarget.value)}
          />
        </div>
      </Show>

      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
