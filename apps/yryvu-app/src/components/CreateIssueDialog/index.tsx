// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, Show } from "solid-js";

import { Dialog } from "../Dialog";
import { MarkdownEditor } from "../MarkdownEditor";
import { MultiSelect, type MultiSelectOption } from "../MultiSelect";
import { Select } from "../MultiSelect/Select";
import { closeCreateIssueDialog, createIssueDialog } from "./state";

/// Cross-provider "Create issue" form. Title required, body markdown
/// optional, labels + assignees + milestone surfaced as searchable
/// dropdowns populated from the active repo's metadata (matches GK's
/// react-select pattern).
export function CreateIssueDialog() {
  const canSubmit = createMemo(
    () => !createIssueDialog.submitting() && createIssueDialog.title().trim().length > 0,
  );

  const meta = () => createIssueDialog.metadata();

  const labelOptions = createMemo<MultiSelectOption[]>(() => meta()?.labels ?? []);
  const assigneeOptions = createMemo<MultiSelectOption[]>(() => meta()?.collaborators ?? []);
  const milestoneOptions = createMemo<MultiSelectOption[]>(() => meta()?.milestones ?? []);

  function onSubmit() {
    if (!canSubmit()) return;
    void createIssueDialog.submit();
  }

  return (
    <Dialog
      open={createIssueDialog.open()}
      title="Create issue"
      size="wide"
      onClose={closeCreateIssueDialog}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={closeCreateIssueDialog}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            disabled={!canSubmit()}
            onClick={onSubmit}
          >
            {createIssueDialog.submitting() ? "Creating…" : "Create issue"}
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="create-issue-title">Title</label>
        <input
          id="create-issue-title"
          type="text"
          value={createIssueDialog.title()}
          placeholder="Short, descriptive summary"
          onInput={(e) => createIssueDialog.setTitle(e.currentTarget.value)}
          autofocus
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="create-issue-body">Description</label>
        <MarkdownEditor
          textareaId="create-issue-body"
          value={createIssueDialog.body()}
          onInput={createIssueDialog.setBody}
          placeholder="What's going on? Reproduction steps, expected vs actual, screenshots…"
          rows={10}
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Labels</label>
        <MultiSelect
          options={labelOptions()}
          selected={createIssueDialog.labels()}
          onChange={createIssueDialog.setLabels}
          placeholder="Search labels"
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Assignees</label>
        <MultiSelect
          options={assigneeOptions()}
          selected={createIssueDialog.assignees()}
          onChange={createIssueDialog.setAssignees}
          placeholder="Search assignees"
          showAvatars
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Milestone</label>
        <Select
          options={milestoneOptions()}
          value={createIssueDialog.milestone()}
          onChange={createIssueDialog.setMilestone}
          placeholder="Search milestones"
        />
      </div>

      <Show when={createIssueDialog.error()}>
        <p class="dialog__error">{createIssueDialog.error()}</p>
      </Show>
    </Dialog>
  );
}
