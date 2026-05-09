// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, For, onMount, Show } from "solid-js";
import { open as openPicker } from "@tauri-apps/plugin-dialog";

import { listGitignoreTemplates, listLicenseTemplates } from "../../../ipc";
import { Dialog } from "../../Dialog";
import { closeInitDialog, initDialog } from "./state";
import { submitInitDialog } from "./submit";
import {
  checkBranchName,
  checkFolderName,
  checkParentPath,
  fieldErrorMessage,
} from "./validation";

export function InitDialog() {
  onMount(async () => {
    const [gi, li] = await Promise.all([
      listGitignoreTemplates(),
      listLicenseTemplates(),
    ]);
    initDialog.setGitignoreOptions(gi);
    initDialog.setLicenseOptions(li);
  });

  const parentError = createMemo(() => checkParentPath(initDialog.parentPath()));
  const folderError = createMemo(() => checkFolderName(initDialog.folderName()));
  const branchError = createMemo(() => checkBranchName(initDialog.branchName()));

  const canSubmit = createMemo(
    () =>
      !initDialog.submitting() &&
      parentError().kind === "ok" &&
      folderError().kind === "ok" &&
      branchError().kind === "ok",
  );

  async function pickParent() {
    const picked = await openPicker({
      directory: true,
      multiple: false,
      title: "Choose where to create the repository",
    });
    if (typeof picked === "string") {
      initDialog.setParentPath(picked);
    }
  }

  function onSubmit() {
    if (!canSubmit()) return;
    void submitInitDialog();
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key === "Enter") onSubmit();
  }

  return (
    <Dialog
      open={initDialog.open()}
      title="Initialize a new repository"
      onClose={closeInitDialog}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={closeInitDialog}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            disabled={!canSubmit()}
            onClick={onSubmit}
          >
            {initDialog.submitting() ? "Initializing…" : "Initialize"}
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="init-parent-path">Parent folder</label>
        <div class="dialog__row">
          <input
            id="init-parent-path"
            type="text"
            value={initDialog.parentPath()}
            placeholder="/path/to/parent"
            onInput={(e) => initDialog.setParentPath(e.currentTarget.value)}
            onKeyDown={onEnter}
          />
          <button class="dialog__btn" type="button" onClick={() => void pickParent()}>
            Browse…
          </button>
        </div>
        <Show when={fieldErrorMessage(parentError())}>
          <p class="dialog__field-error">{fieldErrorMessage(parentError())}</p>
        </Show>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="init-folder-name">Folder name</label>
        <input
          id="init-folder-name"
          type="text"
          value={initDialog.folderName()}
          placeholder="my-repo"
          onInput={(e) => initDialog.setFolderName(e.currentTarget.value)}
          onKeyDown={onEnter}
        />
        <Show when={fieldErrorMessage(folderError())}>
          <p class="dialog__field-error">{fieldErrorMessage(folderError())}</p>
        </Show>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="init-branch">Initial branch</label>
        <input
          id="init-branch"
          type="text"
          value={initDialog.branchName()}
          onInput={(e) => initDialog.setBranchName(e.currentTarget.value)}
          onKeyDown={onEnter}
        />
        <Show when={fieldErrorMessage(branchError())}>
          <p class="dialog__field-error">{fieldErrorMessage(branchError())}</p>
        </Show>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="init-gitignore">.gitignore template</label>
        <select
          id="init-gitignore"
          value={initDialog.gitignoreTemplate() ?? ""}
          onChange={(e) =>
            initDialog.setGitignoreTemplate(
              e.currentTarget.value === "" ? undefined : e.currentTarget.value,
            )
          }
        >
          <option value="">None</option>
          <For each={initDialog.gitignoreOptions()}>
            {(t) => <option value={t.name}>{t.displayLabel}</option>}
          </For>
        </select>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="init-license">License template</label>
        <select
          id="init-license"
          value={initDialog.licenseTemplate() ?? ""}
          onChange={(e) =>
            initDialog.setLicenseTemplate(
              e.currentTarget.value === "" ? undefined : e.currentTarget.value,
            )
          }
        >
          <option value="">None</option>
          <For each={initDialog.licenseOptions()}>
            {(t) => <option value={t.name}>{t.displayLabel}</option>}
          </For>
        </select>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label class="dialog__checkbox">
          <input
            type="checkbox"
            checked={initDialog.initializeFirstCommit()}
            onChange={(e) =>
              initDialog.setInitializeFirstCommit(e.currentTarget.checked)
            }
          />
          Create initial commit
        </label>
      </div>

      <div class="dialog__field" style={{ "margin-top": "4px" }}>
        <label class="dialog__checkbox">
          <input
            type="checkbox"
            checked={initDialog.bare()}
            onChange={(e) => initDialog.setBare(e.currentTarget.checked)}
          />
          Bare repository
        </label>
      </div>

      <Show when={initDialog.error()}>
        <p class="dialog__error">{initDialog.error()}</p>
      </Show>
    </Dialog>
  );
}
