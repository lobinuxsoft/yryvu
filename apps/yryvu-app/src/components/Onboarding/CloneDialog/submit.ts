// SPDX-License-Identifier: AGPL-3.0-or-later

import { cloneCancel, cloneRepository } from "../../../ipc";
import { pushRecentRepo } from "../../../state";
import { openRepoInAnotherTab } from "../../../tabs/ops";
import { notify } from "../../Notifications";
import { closeCloneDialog, cloneDialog } from "./state";

function joinPath(parent: string, name: string): string {
  const stripped = parent.replace(/\/+$/, "");
  return `${stripped}/${name.trim()}`;
}

/// Maps clone BackendError Display strings to user-facing copy. The
/// generic fallback keeps libgit2 / gix internals from leaking out.
function friendlyError(raw: string): string {
  if (raw.startsWith("clone cancelled")) {
    return "Clone cancelled.";
  }
  if (raw.startsWith("clone authentication failed")) {
    return "Authentication failed — check your SSH key or HTTPS credentials.";
  }
  if (raw.startsWith("clone network error")) {
    const detail = raw.split(":").slice(1).join(":").trim();
    return detail.length > 0 ? `Network error: ${detail}` : "Network error.";
  }
  if (raw.startsWith("clone url is invalid")) {
    return "Invalid repository URL.";
  }
  if (raw.startsWith("clone destination already exists")) {
    return "Destination already exists or is not empty.";
  }
  return "Clone failed. Check the URL and parent path are reachable.";
}

export async function submitCloneDialog() {
  if (cloneDialog.submitting()) return;

  const dest = joinPath(cloneDialog.parentPath(), cloneDialog.folderName());
  const sessionId = crypto.randomUUID();
  const depthRaw = cloneDialog.depth().trim();
  const depth = depthRaw.length > 0 ? Number(depthRaw) : undefined;
  const branchRaw = cloneDialog.branch().trim();
  const branch = branchRaw.length > 0 ? branchRaw : undefined;

  cloneDialog.setSubmitting(true);
  cloneDialog.setError(null);
  cloneDialog.setProgress(null);
  cloneDialog.setSessionId(sessionId);

  // When the active tab is a provider sub-tab (#374), forward the
  // integration type so the backend can resolve the matching token
  // from the keyring and inject it into the HTTPS clone — otherwise
  // private repos fail with no system git credential helper.
  const tab = cloneDialog.activeTab();
  const integrationType = tab === "url" ? undefined : tab;

  try {
    const finalPath = await cloneRepository({
      sessionId,
      url: cloneDialog.url().trim(),
      destPath: dest,
      branch,
      depth: Number.isFinite(depth) ? depth : undefined,
      recurseSubmodules: cloneDialog.recurseSubmodules(),
      integrationType,
      onProgress: (p) => cloneDialog.setProgress(p),
    });

    pushRecentRepo(finalPath);
    closeCloneDialog();
    notify.success("Repository cloned", { message: finalPath });
    void openRepoInAnotherTab(finalPath);
  } catch (e) {
    const raw = typeof e === "string" ? e : (e as Error).message;
    if (raw.startsWith("clone cancelled")) {
      // User-driven cancel: close silently, keep recents pristine.
      closeCloneDialog();
      notify.info("Clone cancelled");
      return;
    }
    cloneDialog.setError(friendlyError(raw));
  } finally {
    cloneDialog.setSubmitting(false);
    cloneDialog.setSessionId(null);
    cloneDialog.setProgress(null);
  }
}

export async function cancelCloneDialog() {
  const id = cloneDialog.sessionId();
  if (!id) return;
  await cloneCancel(id);
  // The actual UI reset happens when cloneRepository's promise resolves
  // with CloneCancelled — the finally block in submitCloneDialog flips
  // submitting back to false.
}
