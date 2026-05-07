// SPDX-License-Identifier: AGPL-3.0-or-later

import { initRepository } from "../../../ipc";
import { pushRecentRepo } from "../../../state";
import { openRepoInAnotherTab } from "../../../tabs/ops";
import { notify } from "../../Notifications";
import { closeInitDialog, initDialog } from "./state";

function joinPath(parent: string, name: string): string {
  const stripped = parent.replace(/\/+$/, "");
  return `${stripped}/${name.trim()}`;
}

/// Maps a `BackendError` Display string to user-facing copy. The
/// generic fallback matters: it ensures that a stray libgit2 / gix
/// message never reaches the dialog body.
function friendlyError(raw: string): string {
  if (raw.startsWith("init destination already exists")) {
    return "A repository already exists at that location.";
  }
  if (raw.startsWith("init path is invalid")) {
    const reason = raw.match(/\((.*?)\)/)?.[1] ?? "invalid path";
    return `Cannot create repository: ${reason}.`;
  }
  if (raw.startsWith("template '")) {
    return "Selected template is missing — please pick another.";
  }
  if (raw.startsWith("init write failed")) {
    return "Failed to write template files to the new repository.";
  }
  if (raw.startsWith("invalid branch name")) {
    return "Invalid branch name.";
  }
  return "Initialization failed. Check the parent path is writable.";
}

export async function submitInitDialog() {
  if (initDialog.submitting()) return;

  const dest = joinPath(initDialog.parentPath(), initDialog.folderName());

  initDialog.setSubmitting(true);
  initDialog.setError(null);

  try {
    const finalPath = await initRepository({
      path: dest,
      branchName: initDialog.branchName().trim(),
      gitignoreTemplate: initDialog.gitignoreTemplate(),
      licenseTemplate: initDialog.licenseTemplate(),
      initializeFirstCommit: initDialog.initializeFirstCommit(),
      bare: initDialog.bare(),
    });

    pushRecentRepo(finalPath);
    closeInitDialog();
    notify.success("Repository initialized", { message: finalPath });
    if (!initDialog.bare()) {
      void openRepoInAnotherTab(finalPath);
    }
  } catch (e) {
    const raw = typeof e === "string" ? e : (e as Error).message;
    initDialog.setError(friendlyError(raw));
    initDialog.setSubmitting(false);
  }
}
