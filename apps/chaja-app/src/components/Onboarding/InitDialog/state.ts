// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import type { TemplateInfo } from "../../../ipc";

const [open, setOpen] = createSignal(false);
const [parentPath, setParentPath] = createSignal("");
const [folderName, setFolderName] = createSignal("");
const [branchName, setBranchName] = createSignal("main");
const [gitignoreTemplate, setGitignoreTemplate] = createSignal<string | undefined>(undefined);
const [licenseTemplate, setLicenseTemplate] = createSignal<string | undefined>(undefined);
const [bare, setBare] = createSignal(false);
const [initializeFirstCommit, setInitializeFirstCommit] = createSignal(true);
const [error, setError] = createSignal<string | null>(null);
const [submitting, setSubmitting] = createSignal(false);
const [gitignoreOptions, setGitignoreOptions] = createSignal<TemplateInfo[]>([]);
const [licenseOptions, setLicenseOptions] = createSignal<TemplateInfo[]>([]);

export const initDialog = {
  open,
  parentPath,
  folderName,
  branchName,
  gitignoreTemplate,
  licenseTemplate,
  bare,
  initializeFirstCommit,
  error,
  submitting,
  gitignoreOptions,
  licenseOptions,
  setParentPath,
  setFolderName,
  setBranchName,
  setGitignoreTemplate,
  setLicenseTemplate,
  setBare,
  setInitializeFirstCommit,
  setError,
  setSubmitting,
  setGitignoreOptions,
  setLicenseOptions,
};

function reset() {
  setParentPath("");
  setFolderName("");
  setBranchName("main");
  setGitignoreTemplate(undefined);
  setLicenseTemplate(undefined);
  setBare(false);
  setInitializeFirstCommit(true);
  setError(null);
  setSubmitting(false);
}

export function openInitDialog() {
  reset();
  setOpen(true);
}

export function closeInitDialog() {
  setOpen(false);
}
