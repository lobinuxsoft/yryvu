// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import type { CloneProgress } from "../../../ipc";

/// Active sub-tab in the Clone dialog sidebar. `"url"` is the
/// canonical "Clone with URL" form; the rest match
/// `IntegrationType` from the providerTable so the dispatcher can
/// look the provider up directly.
export type CloneTabId =
  | "url"
  | "github"
  | "githubEnterprise"
  | "gitlab"
  | "gitlabSelfHosted"
  | "gitea"
  | "giteaSelfHosted"
  | "bitbucket"
  | "bitbucketServer"
  | "azureDevops";

const [open, setOpen] = createSignal(false);
const [activeTab, setActiveTab] = createSignal<CloneTabId>("url");
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
  activeTab,
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
  setActiveTab,
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
  setActiveTab("url");
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
