// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createSignal, Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Edit-remote dialog: name, fetch URL, push URL.
 *
 * The name is editable — libgit2's `remote_rename` renames the config
 * section, rewrites the default fetch refspec and moves the tracking
 * refs in one call, so nothing needs re-fetching (#132). It used to be
 * immutable here on the claim that no such call existed.
 *
 * Push URL empty means `remote.<name>.pushurl` is unset and pushes
 * follow the fetch URL — which is why the placeholder shows the fetch
 * URL rather than pre-filling it. Pre-filling would pin the value, and
 * a later fetch-URL edit would leave pushes going somewhere else with
 * nothing on screen to explain it.
 */
export function EditRemoteDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "edit-remote" ? d : null;
  };

  const [name, setName] = createSignal("");
  const [fetchUrl, setFetchUrl] = createSignal("");
  const [pushUrl, setPushUrl] = createSignal("");

  // Seed the fields whenever a remote is opened for editing. Keyed on
  // the dialog state so reopening on a different remote re-seeds rather
  // than showing the previous one's values.
  createEffect(() => {
    const s = state();
    if (!s) return;
    setName(s.remote.name);
    setFetchUrl(s.remote.fetchUrl ?? "");
    setPushUrl(s.remote.pushUrl ?? "");
  });

  const canSubmit = () =>
    name().trim().length > 0 && fetchUrl().trim().length > 0;

  const submit = () => {
    if (!canSubmit()) return;
    void ops.submitEditRemote({
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
      open={ops.dialog()?.kind === "edit-remote"}
      title={`Edit remote ${state()?.remote.name ?? ""}`}
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
            Save
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="edit-remote-name">Name</label>
        <input
          id="edit-remote-name"
          type="text"
          value={name()}
          placeholder="origin"
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div class="dialog__field">
        <label for="edit-remote-url">Fetch URL</label>
        <input
          id="edit-remote-url"
          type="text"
          value={fetchUrl()}
          placeholder="git@github.com:user/repo.git"
          onInput={(e) => setFetchUrl(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div class="dialog__field">
        <label for="edit-remote-push-url">Push URL</label>
        <input
          id="edit-remote-push-url"
          type="text"
          value={pushUrl()}
          placeholder={fetchUrl() || "same as fetch URL"}
          onInput={(e) => setPushUrl(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <p class="dialog__hint">
          Leave empty to push to the fetch URL.
        </p>
      </div>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
