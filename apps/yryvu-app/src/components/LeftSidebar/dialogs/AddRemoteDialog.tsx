// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createSignal, Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Add-remote dialog: name, fetch URL, and an optional push URL.
 *
 * Fields are local rather than the shared `dialogNameInput` /
 * `dialogPathInput` pair — there are three of them, and this matches
 * `EditRemoteDialog` so both remote forms read the same way. Submit
 * calls `add_remote`, which validates the name shape and rejects
 * duplicates with typed errors surfaced inline.
 *
 * An empty push URL leaves `remote.<name>.pushurl` unset, so pushes
 * follow the fetch URL and keep following it if it is later edited.
 */
export function AddRemoteDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const [name, setName] = createSignal("");
  const [fetchUrl, setFetchUrl] = createSignal("");
  const [pushUrl, setPushUrl] = createSignal("");

  // Clear the form each time the dialog opens so a cancelled attempt
  // doesn't reappear pre-filled.
  createEffect(() => {
    if (ops.dialog()?.kind === "add-remote") {
      setName("");
      setFetchUrl("");
      setPushUrl("");
    }
  });

  const canSubmit = () =>
    name().trim().length > 0 && fetchUrl().trim().length > 0;

  const submit = () => {
    if (!canSubmit()) return;
    void ops.submitAddRemote({
      name: name().trim(),
      fetchUrl: fetchUrl().trim(),
      pushUrl: pushUrl().trim(),
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") submit();
  };

  return (
    <Dialog
      open={ops.dialog()?.kind === "add-remote"}
      title="Add remote"
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
            onClick={submit}
          >
            Add
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="add-remote-name">Name</label>
        <input
          id="add-remote-name"
          type="text"
          value={name()}
          placeholder="upstream"
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="add-remote-url">Fetch URL</label>
        <input
          id="add-remote-url"
          type="text"
          value={fetchUrl()}
          placeholder="git@github.com:user/repo.git"
          onInput={(e) => setFetchUrl(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="add-remote-push-url">Push URL</label>
        <input
          id="add-remote-push-url"
          type="text"
          value={pushUrl()}
          placeholder={fetchUrl() || "same as fetch URL"}
          onInput={(e) => setPushUrl(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <p class="dialog__hint">Leave empty to push to the fetch URL.</p>
      </div>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
