// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stash create dialog (issue #12). Replaces the toolbar's one-click
 * stash flow with a small form: free-form message + two flag
 * checkboxes (`include untracked`, `include ignored`). Mirrors GK's
 * `New Stash` modal (audit doc 04 stashes-section, "Create stash"
 * popover) — same field order, same defaults (untracked ON, ignored
 * OFF).
 *
 * Dialog state lives in `state/stash-dialog.ts` so any caller can
 * surface the same dialog (toolbar, command palette, sidebar header).
 */

import { createSignal, type JSX } from "solid-js";

import { stashPush } from "../../ipc";
import {
  closeStashDialog,
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  stashDialogOpen,
} from "../../state";
import { Dialog } from "../Dialog";
import { notify } from "../Notifications";

export function StashCreateDialog(): JSX.Element {
  const [message, setMessage] = createSignal("");
  const [includeUntracked, setIncludeUntracked] = createSignal(true);
  const [includeIgnored, setIncludeIgnored] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  function reset() {
    setMessage("");
    setIncludeUntracked(true);
    setIncludeIgnored(false);
    setBusy(false);
  }

  function cancel() {
    closeStashDialog();
    reset();
  }

  async function submit() {
    const p = repoPath();
    if (!p) return;
    setBusy(true);
    try {
      const m = message().trim();
      await stashPush(p, {
        message: m === "" ? undefined : m,
        includeUntracked: includeUntracked(),
        includeIgnored: includeIgnored(),
      });
      notify.success("Stashed", {
        message: m || "(no message)",
        category: "stash",
      });
      refreshWorkingTree();
      refreshGraph();
      refreshBranches();
      closeStashDialog();
      reset();
    } catch (err) {
      notify.error("Stash failed", {
        message: String(err),
        category: "stash",
      });
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={stashDialogOpen()}
      title="New stash"
      onClose={cancel}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={cancel}
            disabled={busy()}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            onClick={() => void submit()}
            disabled={busy()}
          >
            {busy() ? "Stashing…" : "Stash changes"}
          </button>
        </>
      }
    >
      <label class="dialog__field">
        <span class="dialog__field-label">Message (optional)</span>
        <input
          class="dialog__input"
          type="text"
          autofocus
          placeholder="WIP on feature/x"
          value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy()) void submit();
          }}
        />
      </label>
      <label class="dialog__checkbox">
        <input
          type="checkbox"
          checked={includeUntracked()}
          onChange={(e) => setIncludeUntracked(e.currentTarget.checked)}
        />
        Include untracked files
      </label>
      <label class="dialog__checkbox">
        <input
          type="checkbox"
          checked={includeIgnored()}
          onChange={(e) => setIncludeIgnored(e.currentTarget.checked)}
        />
        Include ignored files
      </label>
    </Dialog>
  );
}
