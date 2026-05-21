// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  abortInteractiveRebase,
  beginInteractiveRebase,
  continueInteractiveRebase,
  getInteractiveRebaseState,
  listCommitsForRebase,
  skipInteractiveRebaseStep,
  type CommitSummary,
  type RebaseActionKind,
  type RebaseState,
  type RebaseStep,
} from "../../ipc";
import { notify } from "../Notifications";
import { refreshGraph, refreshWorkingTree } from "../../state";

interface PlanRow {
  oid: string;
  short_oid: string;
  summary: string;
  action: RebaseActionKind;
  new_message: string;
}

const [open, setOpen] = createSignal(false);
const [repoPath, setRepoPath] = createSignal<string | null>(null);
const [onto, setOnto] = createSignal<string | null>(null);
const [ontoLabel, setOntoLabel] = createSignal<string | null>(null);
const [rows, setRows] = createSignal<PlanRow[]>([]);
const [submitting, setSubmitting] = createSignal(false);
const [state, setState] = createSignal<RebaseState | null>(null);
const [error, setError] = createSignal<string | null>(null);

function summariesToRows(summaries: CommitSummary[]): PlanRow[] {
  // Picker shows oldest at the top (matches git rebase todo order).
  // The backend list is HEAD-first; reverse it for the UI.
  return summaries
    .slice()
    .reverse()
    .map((c) => ({
      oid: c.oid,
      short_oid: c.short_oid,
      summary: c.summary,
      action: "pick" as RebaseActionKind,
      new_message: "",
    }));
}

async function openDialog(path: string, ontoOid: string, ontoDisplay: string) {
  setOpen(true);
  setRepoPath(path);
  setOnto(ontoOid);
  setOntoLabel(ontoDisplay);
  setRows([]);
  setState(null);
  setError(null);

  try {
    const existing = await getInteractiveRebaseState(path);
    if (existing) {
      setState(existing);
      return;
    }
    const commits = await listCommitsForRebase(path, ontoOid);
    if (commits.length === 0) {
      setError("No commits to rebase — branch is already on target.");
      return;
    }
    setRows(summariesToRows(commits));
  } catch (e) {
    setError(`${e}`);
  }
}

function close() {
  setOpen(false);
  setRepoPath(null);
  setOnto(null);
  setOntoLabel(null);
  setRows([]);
  setState(null);
  setError(null);
}

function setAction(idx: number, action: RebaseActionKind) {
  setRows((rs) => {
    const next = rs.slice();
    next[idx] = { ...next[idx], action };
    return next;
  });
}

function setRowMessage(idx: number, message: string) {
  setRows((rs) => {
    const next = rs.slice();
    next[idx] = { ...next[idx], new_message: message };
    return next;
  });
}

function reorder(fromIdx: number, toIdx: number) {
  if (fromIdx === toIdx) return;
  setRows((rs) => {
    const next = rs.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    return next;
  });
}

async function submit() {
  const path = repoPath();
  const ontoOid = onto();
  if (!path || !ontoOid) return;
  const current = rows();
  if (current.length === 0) return;
  // The first non-drop step cannot be squash/fixup (backend rejects).
  const firstActive = current.find((r) => r.action !== "drop");
  if (firstActive && (firstActive.action === "squash" || firstActive.action === "fixup")) {
    setError("The first step in the plan cannot be Squash or Fixup.");
    return;
  }
  setSubmitting(true);
  setError(null);
  try {
    const steps: RebaseStep[] = current.map((r) => ({
      oid: r.oid,
      action: r.action,
      new_message:
        r.action === "reword" && r.new_message.trim().length > 0 ? r.new_message : null,
    }));
    // Validate reword rows have a message — backend enforces this too.
    for (const s of steps) {
      if (s.action === "reword" && !s.new_message) {
        setError(`Reword step ${s.oid.slice(0, 7)} needs a new message.`);
        setSubmitting(false);
        return;
      }
    }
    const next = await beginInteractiveRebase(path, { onto: ontoOid, steps });
    setState(next);
    refreshGraph();
    refreshWorkingTree();
    if (next.pause_reason === null) {
      notify.success("Rebase complete", {
        message: `${steps.filter((s) => s.action !== "drop").length} commit(s) rewritten.`,
        category: "branch",
      });
      close();
    }
  } catch (e) {
    setError(`${e}`);
  } finally {
    setSubmitting(false);
  }
}

async function continueRun() {
  const path = repoPath();
  if (!path) return;
  setSubmitting(true);
  setError(null);
  try {
    const next = await continueInteractiveRebase(path);
    setState(next);
    refreshGraph();
    refreshWorkingTree();
    if (next.pause_reason === null) {
      notify.success("Rebase complete", { category: "branch" });
      close();
    }
  } catch (e) {
    setError(`${e}`);
  } finally {
    setSubmitting(false);
  }
}

async function skipRun() {
  const path = repoPath();
  if (!path) return;
  setSubmitting(true);
  setError(null);
  try {
    const next = await skipInteractiveRebaseStep(path);
    setState(next);
    refreshGraph();
    refreshWorkingTree();
    if (next.pause_reason === null) {
      notify.success("Rebase complete", { category: "branch" });
      close();
    }
  } catch (e) {
    setError(`${e}`);
  } finally {
    setSubmitting(false);
  }
}

async function abortRun() {
  const path = repoPath();
  if (!path) return;
  setSubmitting(true);
  setError(null);
  try {
    await abortInteractiveRebase(path);
    refreshGraph();
    refreshWorkingTree();
    notify.info("Rebase aborted", { category: "branch" });
    close();
  } catch (e) {
    setError(`${e}`);
  } finally {
    setSubmitting(false);
  }
}

export const rebaseInteractiveDialog = {
  open,
  repoPath,
  ontoLabel,
  rows,
  submitting,
  state,
  error,
  setAction,
  setRowMessage,
  reorder,
  submit,
  continueRun,
  skipRun,
  abortRun,
};

export function openRebaseInteractiveDialog(args: {
  repoPath: string;
  ontoOid: string;
  ontoLabel: string;
}) {
  void openDialog(args.repoPath, args.ontoOid, args.ontoLabel);
}

export function closeRebaseInteractiveDialog() {
  close();
}
