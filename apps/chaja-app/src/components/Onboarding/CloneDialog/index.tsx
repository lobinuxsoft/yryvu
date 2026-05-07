// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, Show } from "solid-js";
import { open as openPicker } from "@tauri-apps/plugin-dialog";

import { Dialog } from "../../Dialog";
import { closeCloneDialog, cloneDialog } from "./state";
import { cancelCloneDialog, submitCloneDialog } from "./submit";
import {
  checkFolderName,
  checkParentPath,
  checkUrl,
  deriveFolderName,
  detectProtocol,
  fieldErrorMessage,
} from "./validation";

export function CloneDialog() {
  // Auto-derive the folder name from the URL until the user edits it.
  createEffect(() => {
    if (cloneDialog.folderTouched()) return;
    const derived = deriveFolderName(cloneDialog.url());
    cloneDialog.setFolderName(derived);
  });

  const urlError = createMemo(() => checkUrl(cloneDialog.url()));
  const parentError = createMemo(() => checkParentPath(cloneDialog.parentPath()));
  const folderError = createMemo(() => checkFolderName(cloneDialog.folderName()));
  const protocolHint = createMemo(() => detectProtocol(cloneDialog.url()));

  const canSubmit = createMemo(
    () =>
      !cloneDialog.submitting() &&
      urlError().kind === "ok" &&
      parentError().kind === "ok" &&
      folderError().kind === "ok",
  );

  async function pickParent() {
    const picked = await openPicker({
      directory: true,
      multiple: false,
      title: "Choose where to clone the repository",
    });
    if (typeof picked === "string") {
      cloneDialog.setParentPath(picked);
    }
  }

  function onSubmit() {
    if (!canSubmit()) return;
    void submitCloneDialog();
  }

  function onCancel() {
    void cancelCloneDialog();
  }

  return (
    <Dialog
      open={cloneDialog.open()}
      title="Clone a repository"
      onClose={closeCloneDialog}
      dismissOnBackdrop={!cloneDialog.submitting()}
      footer={
        <Show
          when={!cloneDialog.submitting()}
          fallback={
            <button
              class="dialog__btn dialog__btn--danger"
              type="button"
              onClick={onCancel}
            >
              Cancel clone
            </button>
          }
        >
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={closeCloneDialog}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            disabled={!canSubmit()}
            onClick={onSubmit}
          >
            Clone
          </button>
        </Show>
      }
    >
      <div class="dialog__field">
        <label for="clone-url">Repository URL</label>
        <input
          id="clone-url"
          type="text"
          value={cloneDialog.url()}
          placeholder="https://github.com/user/repo.git"
          disabled={cloneDialog.submitting()}
          onInput={(e) => cloneDialog.setUrl(e.currentTarget.value)}
        />
        <Show when={fieldErrorMessage(urlError())}>
          <p class="dialog__field-error">{fieldErrorMessage(urlError())}</p>
        </Show>
        <Show when={protocolHint() === "ssh"}>
          <p class="dialog__field-hint">
            SSH URL — make sure your SSH agent has the matching key loaded.
          </p>
        </Show>
        <Show when={protocolHint() === "http"}>
          <p class="dialog__field-hint">
            Insecure http:// URL — credentials and cloned data are not encrypted.
          </p>
        </Show>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="clone-parent">Parent folder</label>
        <div class="dialog__row">
          <input
            id="clone-parent"
            type="text"
            value={cloneDialog.parentPath()}
            placeholder="/path/to/parent"
            disabled={cloneDialog.submitting()}
            onInput={(e) => cloneDialog.setParentPath(e.currentTarget.value)}
          />
          <button
            class="dialog__btn"
            type="button"
            disabled={cloneDialog.submitting()}
            onClick={() => void pickParent()}
          >
            Browse…
          </button>
        </div>
        <Show when={fieldErrorMessage(parentError())}>
          <p class="dialog__field-error">{fieldErrorMessage(parentError())}</p>
        </Show>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="clone-folder">Folder name</label>
        <input
          id="clone-folder"
          type="text"
          value={cloneDialog.folderName()}
          placeholder="my-repo"
          disabled={cloneDialog.submitting()}
          onInput={(e) => {
            cloneDialog.setFolderTouched(true);
            cloneDialog.setFolderName(e.currentTarget.value);
          }}
        />
        <Show when={fieldErrorMessage(folderError())}>
          <p class="dialog__field-error">{fieldErrorMessage(folderError())}</p>
        </Show>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="clone-branch">Branch (optional)</label>
        <input
          id="clone-branch"
          type="text"
          value={cloneDialog.branch()}
          placeholder="default"
          disabled={cloneDialog.submitting()}
          onInput={(e) => cloneDialog.setBranch(e.currentTarget.value)}
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="clone-depth">Shallow depth (optional)</label>
        <input
          id="clone-depth"
          type="number"
          min="1"
          value={cloneDialog.depth()}
          placeholder="full history"
          disabled={cloneDialog.submitting()}
          onInput={(e) => cloneDialog.setDepth(e.currentTarget.value)}
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label class="dialog__checkbox">
          <input
            type="checkbox"
            checked={cloneDialog.recurseSubmodules()}
            disabled={cloneDialog.submitting()}
            onChange={(e) =>
              cloneDialog.setRecurseSubmodules(e.currentTarget.checked)
            }
          />
          Recurse submodules
        </label>
      </div>

      <Show when={cloneDialog.submitting()}>
        {(() => {
          const p = cloneDialog.progress();
          return (
            <div class="dialog__progress" style={{ "margin-top": "12px" }}>
              <div class="dialog__progress-label">
                {phaseLabel(p?.phase)} — {p?.percent ?? 0}%
                <Show when={p && p.total > 0}>
                  <span class="dialog__progress-counter">
                    {" "}
                    ({p?.current ?? 0} / {p?.total ?? 0})
                  </span>
                </Show>
              </div>
              <div class="dialog__progress-track">
                <div
                  class="dialog__progress-bar"
                  style={{ width: `${p?.percent ?? 0}%` }}
                />
              </div>
            </div>
          );
        })()}
      </Show>

      <Show when={cloneDialog.error()}>
        <p class="dialog__error">{cloneDialog.error()}</p>
      </Show>
    </Dialog>
  );
}

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case "counting":
      return "Counting objects";
    case "compressing":
      return "Compressing";
    case "receiving":
      return "Receiving objects";
    case "resolving":
      return "Resolving deltas";
    case "checkout":
      return "Checking out files";
    default:
      return "Starting…";
  }
}
