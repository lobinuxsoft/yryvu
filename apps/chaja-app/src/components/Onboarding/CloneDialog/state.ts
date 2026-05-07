// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import type { CloneProgress } from "../../../ipc";

const [open, setOpen] = createSignal(false);
const [url, setUrl] = createSignal("");
const [parentPath, setParentPath] = createSignal("");
const [folderName, setFolderName] = createSignal("");
const [folderTouched, setFolderTouched] = createSignal(false);
const [branch, setBranch] = createSignal("");
const [depth, setDepth] = createSignal("");
const [recurseSubmodules, setRecurseSubmodules] = createSignal(false);
const [submitting, setSubmitting] = createSignal(false);
const [progress, setProgress] = createSignal<CloneProgress | null>(null);
const [error, setError] = createSignal<string | null>(null);
const [sessionId, setSessionId] = createSignal<string | null>(null);

export const cloneDialog = {
  open,
  url,
  parentPath,
  folderName,
  folderTouched,
  branch,
  depth,
  recurseSubmodules,
  submitting,
  progress,
  error,
  sessionId,
  setUrl,
  setParentPath,
  setFolderName,
  setFolderTouched,
  setBranch,
  setDepth,
  setRecurseSubmodules,
  setSubmitting,
  setProgress,
  setError,
  setSessionId,
};

function reset() {
  setUrl("");
  setParentPath("");
  setFolderName("");
  setFolderTouched(false);
  setBranch("");
  setDepth("");
  setRecurseSubmodules(false);
  setSubmitting(false);
  setProgress(null);
  setError(null);
  setSessionId(null);
}

export function openCloneDialog() {
  reset();
  setOpen(true);
}

export function closeCloneDialog() {
  setOpen(false);
}
