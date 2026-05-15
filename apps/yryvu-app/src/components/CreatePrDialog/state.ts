// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal } from "solid-js";

import type { BranchInfo, PullRequestDetail } from "../../ipc";
import { integrationCreatePr, listBranches } from "../../ipc";
import { openPrDetail } from "../../state/pr-detail";
import { activePrContext, refetchPullRequests } from "../../state/pull-requests";
import { repoPath } from "../../state/repo-base";
import { createRepoMetadataResource } from "../../state/repo-metadata";

const [open, setOpen] = createSignal(false);
const [title, setTitle] = createSignal("");
const [body, setBody] = createSignal("");
const [headRef, setHeadRef] = createSignal<string | null>(null);
const [baseRef, setBaseRef] = createSignal<string | null>(null);
const [draft, setDraft] = createSignal(false);
const [labels, setLabels] = createSignal<string[]>([]);
const [assignees, setAssignees] = createSignal<string[]>([]);
const [reviewers, setReviewers] = createSignal<string[]>([]);
const [milestone, setMilestone] = createSignal<string | null>(null);
const [submitting, setSubmitting] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

const [metadata] = createRepoMetadataResource(() =>
  open() ? activePrContext() : null,
);

const [branches] = createResource<BranchInfo[], string>(
  () => (open() ? (repoPath() ?? "") : ""),
  async (path) => {
    if (!path) return [];
    try {
      return await listBranches(path);
    } catch {
      return [];
    }
  },
  { initialValue: [] },
);

interface OpenOptions {
  prefillHead?: string;
  prefillBase?: string;
}

function reset(opts?: OpenOptions) {
  setTitle("");
  setBody("");
  setHeadRef(opts?.prefillHead ?? null);
  setBaseRef(opts?.prefillBase ?? null);
  setDraft(false);
  setLabels([]);
  setAssignees([]);
  setReviewers([]);
  setMilestone(null);
  setError(null);
  setSubmitting(false);
}

export function openCreatePrDialog(opts?: OpenOptions) {
  reset(opts);
  setOpen(true);
}

export function closeCreatePrDialog() {
  setOpen(false);
}

async function submitCreatePr(): Promise<PullRequestDetail | null> {
  const ctx = activePrContext();
  if (!ctx) {
    setError("No active integration context — open a connected repo first.");
    return null;
  }
  const t = title().trim();
  const h = headRef();
  const b = baseRef();
  if (t.length === 0) {
    setError("Title is required.");
    return null;
  }
  if (!h || !b) {
    setError("Both source and target branches are required.");
    return null;
  }
  setSubmitting(true);
  setError(null);
  try {
    const detail = await integrationCreatePr(
      ctx.integrationType,
      ctx.owner,
      ctx.repo,
      {
        title: t,
        body: body(),
        headRef: h,
        baseRef: b,
        draft: draft(),
        labels: labels(),
        assignees: assignees(),
        reviewers: reviewers(),
        milestone: milestone() ?? undefined,
      },
    );
    refetchPullRequests();
    openPrDetail({
      integrationType: ctx.integrationType,
      owner: ctx.owner,
      repo: ctx.repo,
      number: detail.number,
      headSha: detail.headSha,
    });
    closeCreatePrDialog();
    return detail;
  } catch (err) {
    setError(String(err));
    return null;
  } finally {
    setSubmitting(false);
  }
}

export const createPrDialog = {
  open,
  title,
  body,
  headRef,
  baseRef,
  draft,
  labels,
  assignees,
  reviewers,
  milestone,
  submitting,
  error,
  metadata,
  branches,
  setTitle,
  setBody,
  setHeadRef,
  setBaseRef,
  setDraft,
  setLabels,
  setAssignees,
  setReviewers,
  setMilestone,
  submit: submitCreatePr,
};
