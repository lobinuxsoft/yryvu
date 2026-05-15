// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import type { IssueDetail } from "../../ipc";
import { integrationCreateIssue } from "../../ipc";
import { openIssueDetail } from "../../state/issue-detail";
import { activeIssuesContext, refetchIssues } from "../../state/issues";
import { createRepoMetadataResource } from "../../state/repo-metadata";

const [open, setOpen] = createSignal(false);
const [title, setTitle] = createSignal("");
const [body, setBody] = createSignal("");
const [labels, setLabels] = createSignal<string[]>([]);
const [assignees, setAssignees] = createSignal<string[]>([]);
const [milestone, setMilestone] = createSignal<string | null>(null);
const [submitting, setSubmitting] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

const [metadata] = createRepoMetadataResource(() =>
  open() ? activeIssuesContext() : null,
);

function reset() {
  setTitle("");
  setBody("");
  setLabels([]);
  setAssignees([]);
  setMilestone(null);
  setError(null);
  setSubmitting(false);
}

export function openCreateIssueDialog() {
  reset();
  setOpen(true);
}

export function closeCreateIssueDialog() {
  setOpen(false);
}

async function submitCreateIssue(): Promise<IssueDetail | null> {
  const ctx = activeIssuesContext();
  if (!ctx) {
    setError("No active integration context — open a connected repo first.");
    return null;
  }
  const t = title().trim();
  if (t.length === 0) {
    setError("Title is required.");
    return null;
  }
  setSubmitting(true);
  setError(null);
  try {
    const detail = await integrationCreateIssue(
      ctx.integrationType,
      ctx.owner,
      ctx.repo,
      {
        title: t,
        body: body(),
        labels: labels(),
        assignees: assignees(),
        milestone: milestone() ?? undefined,
      },
    );
    refetchIssues();
    openIssueDetail({
      integrationType: ctx.integrationType,
      owner: ctx.owner,
      repo: ctx.repo,
      number: detail.number,
    });
    closeCreateIssueDialog();
    return detail;
  } catch (err) {
    setError(String(err));
    return null;
  } finally {
    setSubmitting(false);
  }
}

export const createIssueDialog = {
  open,
  title,
  body,
  labels,
  assignees,
  milestone,
  submitting,
  error,
  metadata,
  setTitle,
  setBody,
  setLabels,
  setAssignees,
  setMilestone,
  submit: submitCreateIssue,
};
