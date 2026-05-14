// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../Dialog";
import type { CommitOps } from "./useCommitOps";

export function CommitDialogs(props: { ops: CommitOps }) {
  const { ops } = props;

  const createBranchState = () =>
    ops.dialog()?.kind === "create-branch"
      ? (ops.dialog() as { sha: string; shortSha: string })
      : undefined;

  const createTagState = () =>
    ops.dialog()?.kind === "create-tag"
      ? (ops.dialog() as { sha: string; shortSha: string; annotated: boolean })
      : undefined;

  const checkoutDirtyState = () =>
    ops.dialog()?.kind === "checkout-dirty"
      ? (ops.dialog() as { sha: string; shortSha: string })
      : undefined;

  const resetHardState = () =>
    ops.dialog()?.kind === "reset-hard-confirm"
      ? (ops.dialog() as { sha: string; shortSha: string })
      : undefined;

  const patchSavedState = () =>
    ops.dialog()?.kind === "patch-saved"
      ? (ops.dialog() as { path: string })
      : undefined;

  return (
    <>
      <Dialog
        open={ops.dialog()?.kind === "create-branch"}
        title="Create branch from commit"
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
              disabled={!ops.nameInput().trim()}
              onClick={ops.submitCreateBranch}
            >
              Create
            </button>
          </>
        }
      >
        <div class="dialog__field">
          <label for="commit-ctx-branch-name">Branch name</label>
          <input
            id="commit-ctx-branch-name"
            type="text"
            value={ops.nameInput()}
            placeholder="my-new-branch"
            onInput={(e) => ops.setNameInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") ops.submitCreateBranch();
            }}
          />
        </div>
        <Show when={createBranchState()}>
          <p
            class="dialog__field"
            style={{
              "margin-top": "8px",
              color: "var(--fg-2)",
              "font-size": "12px",
            }}
          >
            From: <code>{createBranchState()?.shortSha}</code>
          </p>
        </Show>
        <Show when={ops.dialogError()}>
          <p class="dialog__error">{ops.dialogError()}</p>
        </Show>
      </Dialog>

      <Dialog
        open={ops.dialog()?.kind === "create-tag"}
        title={
          createTagState()?.annotated
            ? "Create annotated tag"
            : "Create lightweight tag"
        }
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
              disabled={
                !ops.nameInput().trim() ||
                (!!createTagState()?.annotated && !ops.messageInput().trim())
              }
              onClick={ops.submitCreateTag}
            >
              Create
            </button>
          </>
        }
      >
        <div class="dialog__field">
          <label for="commit-ctx-tag-name">Tag name</label>
          <input
            id="commit-ctx-tag-name"
            type="text"
            value={ops.nameInput()}
            placeholder="v1.0.0"
            onInput={(e) => ops.setNameInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !createTagState()?.annotated) {
                ops.submitCreateTag();
              }
            }}
          />
        </div>
        <Show when={createTagState()?.annotated}>
          <div class="dialog__field" style={{ "margin-top": "8px" }}>
            <label for="commit-ctx-tag-message">Message</label>
            <textarea
              id="commit-ctx-tag-message"
              rows={3}
              value={ops.messageInput()}
              placeholder="Release 1.0.0"
              onInput={(e) => ops.setMessageInput(e.currentTarget.value)}
            />
          </div>
        </Show>
        <Show when={createTagState()}>
          <p
            class="dialog__field"
            style={{
              "margin-top": "8px",
              color: "var(--fg-2)",
              "font-size": "12px",
            }}
          >
            At: <code>{createTagState()?.shortSha}</code>
          </p>
        </Show>
        <Show when={ops.dialogError()}>
          <p class="dialog__error">{ops.dialogError()}</p>
        </Show>
      </Dialog>

      <Dialog
        open={ops.dialog()?.kind === "reset-hard-confirm"}
        title="Reset --hard — destructive"
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
                const s = resetHardState();
                if (s) void ops.doReset(s.sha, "hard");
              }}
            >
              Reset --hard
            </button>
          </>
        }
      >
        <p>
          This will move the current branch tip to{" "}
          <code>{resetHardState()?.shortSha}</code> and{" "}
          <strong>discard all uncommitted changes</strong> in the working tree.
        </p>
        <p
          style={{
            color: "var(--fg-3)",
            "font-size": "12px",
            "margin-top": "8px",
          }}
        >
          Commits that stop being reachable after the reset can still be
          recovered via <code>git reflog</code>.
        </p>
        <Show when={ops.dialogError()}>
          <p class="dialog__error">{ops.dialogError()}</p>
        </Show>
      </Dialog>

      <Dialog
        open={ops.dialog()?.kind === "patch-saved"}
        title="Patch saved"
        onClose={ops.closeDialog}
        footer={
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            onClick={ops.closeDialog}
          >
            OK
          </button>
        }
      >
        <p>Patch written to:</p>
        <p
          style={{
            "margin-top": "8px",
            "font-family": "var(--mono, monospace)",
            "font-size": "12px",
            "word-break": "break-all",
          }}
        >
          <code>{patchSavedState()?.path}</code>
        </p>
      </Dialog>

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
                const s = checkoutDirtyState();
                if (s) void ops.stashAndCheckout(s.sha, s.shortSha);
              }}
            >
              Stash & Checkout
            </button>
          </>
        }
      >
        <p>
          Your working tree has uncommitted changes. Stash them and detach HEAD
          to <code>{checkoutDirtyState()?.shortSha}</code>?
        </p>
        <p
          style={{
            color: "var(--fg-3)",
            "font-size": "12px",
            "margin-top": "8px",
          }}
        >
          Detaching HEAD means new commits will not belong to any branch until
          you create one.
        </p>
        <Show when={ops.dialogError()}>
          <p class="dialog__error">{ops.dialogError()}</p>
        </Show>
      </Dialog>
    </>
  );
}
