// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, Show } from "solid-js";

import { Dialog } from "../Dialog";
import { MarkdownEditor } from "../MarkdownEditor";
import { MultiSelect, type MultiSelectOption } from "../MultiSelect";
import { Select } from "../MultiSelect/Select";
import { closeCreatePrDialog, createPrDialog } from "./state";

/// Cross-provider "Create pull request" form. Title + source +
/// target branches required. Branches are selected from the local
/// branch list (dropdown), metadata fields (labels/assignees/
/// reviewers/milestone) from repo metadata, draft toggle honored by
/// GitHub + GitLab.
export function CreatePrDialog() {
  const canSubmit = createMemo(
    () =>
      !createPrDialog.submitting() &&
      createPrDialog.title().trim().length > 0 &&
      createPrDialog.headRef() !== null &&
      createPrDialog.baseRef() !== null,
  );

  const meta = () => createPrDialog.metadata();

  /// Branches that exist on the remote — those are the ones the
  /// hosting provider can resolve when creating the PR. Tracked by
  /// upstream presence on the local row OR by a matching remote row.
  const pushedNames = createMemo<Set<string>>(() => {
    const out = new Set<string>();
    for (const b of createPrDialog.branches() ?? []) {
      if (b.kind === "remote") {
        // remote name typically arrives as `origin/foo` — strip
        // the remote prefix so it lines up with local names.
        const stripped = b.name.includes("/") ? b.name.split("/").slice(1).join("/") : b.name;
        out.add(stripped);
      } else if (b.upstream) {
        out.add(b.name);
      }
    }
    return out;
  });

  const branchOptions = createMemo<MultiSelectOption[]>(() => {
    const seen = new Set<string>();
    const out: MultiSelectOption[] = [];
    const pushed = pushedNames();
    for (const b of createPrDialog.branches() ?? []) {
      if (b.kind !== "local") continue;
      if (seen.has(b.name)) continue;
      seen.add(b.name);
      const isPushed = pushed.has(b.name);
      out.push({
        id: b.name,
        displayName: isPushed ? b.name : `${b.name} (not pushed)`,
      });
    }
    return out;
  });

  const headNotPushed = createMemo(() => {
    const h = createPrDialog.headRef();
    return h !== null && !pushedNames().has(h);
  });

  const labelOptions = createMemo<MultiSelectOption[]>(() => meta()?.labels ?? []);
  const assigneeOptions = createMemo<MultiSelectOption[]>(() => meta()?.collaborators ?? []);
  const milestoneOptions = createMemo<MultiSelectOption[]>(() => meta()?.milestones ?? []);

  function onSubmit() {
    if (!canSubmit()) return;
    void createPrDialog.submit();
  }

  return (
    <Dialog
      open={createPrDialog.open()}
      title="Create pull request"
      size="wide"
      onClose={closeCreatePrDialog}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={closeCreatePrDialog}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            disabled={!canSubmit()}
            onClick={onSubmit}
          >
            {createPrDialog.submitting() ? "Creating…" : "Create pull request"}
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="create-pr-title">Title</label>
        <input
          id="create-pr-title"
          type="text"
          value={createPrDialog.title()}
          placeholder="Short, descriptive summary"
          onInput={(e) => createPrDialog.setTitle(e.currentTarget.value)}
          autofocus
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Source branch</label>
        <Select
          options={branchOptions()}
          value={createPrDialog.headRef()}
          onChange={createPrDialog.setHeadRef}
          placeholder="Search branches"
        />
        <Show when={headNotPushed()}>
          <p class="dialog__field-hint" style={{ color: "var(--warning)" }}>
            This branch hasn't been pushed to the remote yet. Push it first or
            the hosting provider will reject the create call.
          </p>
        </Show>
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Target branch</label>
        <Select
          options={branchOptions()}
          value={createPrDialog.baseRef()}
          onChange={createPrDialog.setBaseRef}
          placeholder="Search branches"
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="create-pr-body">Description</label>
        <MarkdownEditor
          textareaId="create-pr-body"
          value={createPrDialog.body()}
          onInput={createPrDialog.setBody}
          placeholder="What does this change? Why? Anything reviewers should know?"
          rows={8}
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Labels</label>
        <MultiSelect
          options={labelOptions()}
          selected={createPrDialog.labels()}
          onChange={createPrDialog.setLabels}
          placeholder="Search labels"
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Assignees</label>
        <MultiSelect
          options={assigneeOptions()}
          selected={createPrDialog.assignees()}
          onChange={createPrDialog.setAssignees}
          placeholder="Search assignees"
          showAvatars
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Reviewers</label>
        <MultiSelect
          options={assigneeOptions()}
          selected={createPrDialog.reviewers()}
          onChange={createPrDialog.setReviewers}
          placeholder="Search reviewers"
          showAvatars
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label>Milestone</label>
        <Select
          options={milestoneOptions()}
          value={createPrDialog.milestone()}
          onChange={createPrDialog.setMilestone}
          placeholder="Search milestones"
        />
      </div>

      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label class="dialog__checkbox">
          <input
            type="checkbox"
            checked={createPrDialog.draft()}
            onChange={(e) => createPrDialog.setDraft(e.currentTarget.checked)}
          />
          Open as draft
        </label>
      </div>

      <Show when={createPrDialog.error()}>
        <p class="dialog__error">{createPrDialog.error()}</p>
      </Show>
    </Dialog>
  );
}
