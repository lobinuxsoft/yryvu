// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  acceptConflictSide,
  continueInteractiveRebase,
  finishInProgressOp,
  listConflicts,
  markConflictResolved,
  readConflictDiff3,
  resolveConflictWithContent,
  type ConflictDiff3,
  type ConflictListing,
  type ConflictSide,
  type ConflictSource,
  type ConflictedFile,
} from "../../ipc";
import { notify } from "../Notifications";
import { refreshGraph, refreshWorkingTree } from "../../state";

const [open, setOpen] = createSignal(false);
const [repoPath, setRepoPath] = createSignal<string | null>(null);
const [source, setSource] = createSignal<ConflictSource>("standalone");
const [files, setFiles] = createSignal<ConflictedFile[]>([]);
const [activePath, setActivePath] = createSignal<string | null>(null);
const [diff3, setDiff3] = createSignal<ConflictDiff3 | null>(null);
const [editedOutput, setEditedOutput] = createSignal<string>("");
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

function applyListing(listing: ConflictListing) {
  setSource(listing.source);
  setFiles(listing.files);
  const current = activePath();
  const stillPresent = current && listing.files.some((f) => f.path === current);
  if (!stillPresent) {
    setActivePath(listing.files[0]?.path ?? null);
  }
}

async function refreshList() {
  const path = repoPath();
  if (!path) return;
  try {
    const listing = await listConflicts(path);
    applyListing(listing);
    if (activePath()) {
      await loadDiff3(activePath()!);
    } else {
      setDiff3(null);
      setEditedOutput("");
    }
  } catch (e) {
    setError(`${e}`);
  }
}

async function loadDiff3(path: string) {
  const repo = repoPath();
  if (!repo) return;
  try {
    const d = await readConflictDiff3(repo, path);
    setDiff3(d);
    setEditedOutput(d.working);
  } catch (e) {
    setError(`${e}`);
  }
}

async function openDialog(path: string, prefetched?: ConflictListing) {
  setOpen(true);
  setRepoPath(path);
  setError(null);
  if (prefetched) {
    applyListing(prefetched);
    if (activePath()) await loadDiff3(activePath()!);
  } else {
    await refreshList();
  }
}

function close() {
  setOpen(false);
  setRepoPath(null);
  setFiles([]);
  setActivePath(null);
  setDiff3(null);
  setEditedOutput("");
  setError(null);
}

async function selectFile(path: string) {
  setActivePath(path);
  await loadDiff3(path);
}

async function acceptSide(side: ConflictSide) {
  const repo = repoPath();
  const path = activePath();
  if (!repo || !path) return;
  setBusy(true);
  setError(null);
  try {
    await acceptConflictSide(repo, path, side);
    refreshWorkingTree();
    await refreshList();
  } catch (e) {
    setError(`${e}`);
  } finally {
    setBusy(false);
  }
}

async function saveOutput() {
  const repo = repoPath();
  const path = activePath();
  if (!repo || !path) return;
  setBusy(true);
  setError(null);
  try {
    await resolveConflictWithContent(repo, path, editedOutput());
    refreshWorkingTree();
    await refreshList();
  } catch (e) {
    setError(`${e}`);
  } finally {
    setBusy(false);
  }
}

async function markFromWorktree() {
  const repo = repoPath();
  const path = activePath();
  if (!repo || !path) return;
  setBusy(true);
  setError(null);
  try {
    await markConflictResolved(repo, path);
    refreshWorkingTree();
    await refreshList();
  } catch (e) {
    setError(`${e}`);
  } finally {
    setBusy(false);
  }
}

async function finish() {
  const repo = repoPath();
  if (!repo) return;
  setBusy(true);
  setError(null);
  try {
    if (source() === "interactive-rebase") {
      // yryvu's orchestrator owns the lifecycle — advance it so the
      // next plan step runs (or the rebase completes).
      await continueInteractiveRebase(repo);
      notify.success("Conflict resolved — rebase continued", { category: "branch" });
    } else {
      const finished = await finishInProgressOp(repo);
      notify.success("Conflict resolution complete", {
        message: `Finished ${finished}.`,
        category: "branch",
      });
    }
    refreshGraph();
    refreshWorkingTree();
    close();
  } catch (e) {
    setError(`${e}`);
  } finally {
    setBusy(false);
  }
}

export const conflictDialog = {
  open,
  source,
  files,
  activePath,
  diff3,
  editedOutput,
  busy,
  error,
  setEditedOutput,
  selectFile,
  acceptSide,
  saveOutput,
  markFromWorktree,
  finish,
  refreshList,
};

export function openConflictDialog(args: { repoPath: string; prefetched?: ConflictListing }) {
  void openDialog(args.repoPath, args.prefetched);
}

export function closeConflictDialog() {
  close();
}
