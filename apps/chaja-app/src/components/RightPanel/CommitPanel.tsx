// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, on, Show } from "solid-js";

import { getHeadCommitMessage, type WorkingTreeStatus } from "../../ipc";
import {
  amendEnabled,
  commitDescription,
  commitMessage,
  openStagingDiffTab,
  pendingCommitOptionsExpanded,
  repoPath,
  selectedDiffFile,
  setAmendEnabled,
  setCommitDescription,
  setCommitMessage,
  setPendingCommitOptionsExpanded,
  setSkipHooksEnabled,
  setStagedFilesCollapsed,
  setUnstagedFilesCollapsed,
  skipHooksEnabled,
  stagedFilesCollapsed,
  unstagedFilesCollapsed,
} from "../../state";
import { CommitButton } from "./CommitButton";
import { CommitFileList, type RowAction } from "./CommitFileList";
import { CommitMessage } from "./CommitMessage";

export interface CommitPanelProps {
  status: WorkingTreeStatus | undefined;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onBack: () => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
}

export function CommitPanel(props: CommitPanelProps) {
  const unstaged = () => props.status?.unstaged ?? [];
  const staged = () => props.status?.staged ?? [];
  const stagedCount = () => staged().length;
  const canCommit = () =>
    (stagedCount() > 0 || amendEnabled()) &&
    commitMessage().trim().length > 0;
  const totalChanges = () => unstaged().length + staged().length;

  // Toggling Amend on pre-fills summary/description from HEAD; off clears
  // both. User edits in between are preserved — we only fire on the
  // toggle transition.
  createEffect(
    on(
      amendEnabled,
      async (enabled, prev) => {
        if (enabled === prev) return;
        if (enabled) {
          const p = repoPath();
          if (!p) return;
          try {
            const msg = await getHeadCommitMessage(p);
            const [subject, ...rest] = msg.split("\n\n");
            setCommitMessage(subject.trim());
            setCommitDescription(rest.join("\n\n").trim());
          } catch (err) {
            console.error("head_commit_message failed", err);
          }
        } else {
          setCommitMessage("");
          setCommitDescription("");
        }
      },
      { defer: true },
    ),
  );

  const submitLabel = () => {
    if (amendEnabled()) {
      return stagedCount() > 0
        ? `Amend HEAD with ${stagedCount()} File${stagedCount() === 1 ? "" : "s"}`
        : "Amend HEAD Message";
    }
    return `Commit Changes to ${stagedCount()} File${stagedCount() === 1 ? "" : "s"}`;
  };

  const submitTitle = () => {
    if (!commitMessage().trim()) return "Enter a commit summary";
    if (!amendEnabled() && stagedCount() === 0) {
      return "Stage at least one file before committing";
    }
    return submitLabel();
  };

  const isActive = (side: "unstaged" | "staged", path: string) => {
    const sel = selectedDiffFile();
    return sel?.kind === "staging" && sel.side === side && sel.path === path;
  };

  const unstagedActions: RowAction[] = [
    {
      label: "Stage",
      onClick: (path) => props.onStage([path]),
    },
    {
      label: "Discard",
      variant: "danger",
      title: "Revert this file to HEAD — no undo",
      onClick: (path) => props.onDiscard([path]),
    },
  ];

  const stagedActions: RowAction[] = [
    {
      label: "Unstage",
      onClick: (path) => props.onUnstage([path]),
    },
  ];

  return (
    <div class="commit-panel">
      <div class="commit-panel__header">
        <button
          class="commit-panel__back"
          type="button"
          title="Back to commit details"
          onClick={() => props.onBack()}
        >
          ← Back
        </button>
        <span class="commit-panel__heading">
          {totalChanges()} file change{totalChanges() === 1 ? "" : "s"} in
          working directory
        </span>
      </div>

      <Show when={totalChanges() === 0}>
        <p class="inspector__empty">Working tree is clean.</p>
      </Show>

      <CommitFileList
        title="Unstaged Files"
        side="unstaged"
        changes={unstaged()}
        collapsed={unstagedFilesCollapsed()}
        onToggleCollapsed={() => setUnstagedFilesCollapsed((v) => !v)}
        bulkActionLabel="Stage All Changes"
        onBulkAction={() => props.onStageAll()}
        rowActions={unstagedActions}
        onRowClick={(path) => openStagingDiffTab("unstaged", path)}
        isActive={(path) => isActive("unstaged", path)}
      />

      <CommitFileList
        title="Staged Files"
        side="staged"
        changes={staged()}
        collapsed={stagedFilesCollapsed()}
        onToggleCollapsed={() => setStagedFilesCollapsed((v) => !v)}
        bulkActionLabel="Unstage All Changes"
        onBulkAction={() => props.onUnstageAll()}
        rowActions={stagedActions}
        onRowClick={(path) => openStagingDiffTab("staged", path)}
        isActive={(path) => isActive("staged", path)}
      />

      <section class="commit-panel__commit-form">
        <header class="commit-panel__commit-form__header">
          <span>Commit</span>
          <label class="commit-panel__amend">
            <input
              type="checkbox"
              checked={amendEnabled()}
              onInput={(e) => setAmendEnabled(e.currentTarget.checked)}
            />
            <span>Amend previous commit</span>
          </label>
        </header>

        <CommitMessage
          summary={commitMessage()}
          description={commitDescription()}
          onSummaryChange={setCommitMessage}
          onDescriptionChange={setCommitDescription}
        />

        <div class="commit-panel__options">
          <button
            class="commit-panel__options-toggle"
            type="button"
            aria-expanded={pendingCommitOptionsExpanded()}
            onClick={() => setPendingCommitOptionsExpanded((v) => !v)}
          >
            <span
              class="commit-panel__options-chevron"
              data-collapsed={pendingCommitOptionsExpanded() ? "false" : "true"}
            >
              ▸
            </span>
            Commit Options
          </button>
          <Show when={pendingCommitOptionsExpanded()}>
            <div class="commit-panel__options-body">
              <label class="commit-panel__option">
                <input
                  type="checkbox"
                  checked={skipHooksEnabled()}
                  onInput={(e) =>
                    setSkipHooksEnabled(e.currentTarget.checked)
                  }
                />
                <span>Skip pre-commit hooks</span>
                <span
                  class="commit-panel__option-hint"
                  title="libgit2 never runs hooks; this flag is plumbed for future gix migration"
                >
                  (no-op on current backend)
                </span>
              </label>
              <label class="commit-panel__option" data-disabled="true">
                <input type="checkbox" disabled />
                <span>Sign with GPG</span>
                <span
                  class="commit-panel__option-hint"
                  title="GPG signing is not yet wired — tracked in a separate issue"
                >
                  (coming soon)
                </span>
              </label>
            </div>
          </Show>
        </div>

        <CommitButton
          label={submitLabel()}
          disabled={!canCommit()}
          title={submitTitle()}
          mode={amendEnabled() ? "amend" : "commit"}
          onCommit={() => props.onCommit()}
          onCommitAndPush={() => props.onCommitAndPush()}
        />
      </section>
    </div>
  );
}
