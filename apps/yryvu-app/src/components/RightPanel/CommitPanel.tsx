// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, on, Show } from "solid-js";

import { getHeadCommitMessage, type WorkingTreeStatus } from "../../ipc";
import type { FileDiff } from "../../ipc/diff";
import type { WorkingTreeChange } from "../../ipc/staging";
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
import { FileList, type RowAction } from "../FileList";
import { FileListToolbar } from "../FileList/FileListToolbar";
import { Tooltip } from "../Tooltip";
import {
  collapseAllDirs,
  displayTree,
  expandAllDirs,
  hasAnyCollapsed,
} from "../FileList/store";
import {
  buildTreeFromPaths,
  collectDirPaths,
} from "../FileList/treeBuild";
import { CommitButton } from "./CommitButton";
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

const UNSTAGED_REV: string = "unstaged";
const STAGED_REV: string = "staged";

/// Working-tree changes carry no diffstat (the backend doesn't compute one
/// for the WorkingTreeChange shape). Synthesizing a zero-stat FileDiff lets
/// the FileList widget consume the same row contract as the committed view —
/// the Row's `<Show when={additions>0 || deletions>0}>` guard already hides
/// stats when zero, so the visual matches GitKraken's working-tree rows.
function toFileDiff(change: WorkingTreeChange): FileDiff {
  return {
    path: change.path,
    old_path: change.old_path,
    status: change.status,
    is_binary: false,
    truncated: false,
    old_size: 0,
    new_size: 0,
    additions: 0,
    deletions: 0,
    hunks: [],
  };
}

export function CommitPanel(props: CommitPanelProps) {
  const unstaged = () => props.status?.unstaged ?? [];
  const staged = () => props.status?.staged ?? [];
  const stagedCount = () => staged().length;
  const canCommit = () =>
    (stagedCount() > 0 || amendEnabled()) &&
    commitMessage().trim().length > 0;
  const totalChanges = () => unstaged().length + staged().length;

  const repoId = () => repoPath() ?? "";

  const unstagedFiles = createMemo<FileDiff[]>(() =>
    unstaged().map(toFileDiff),
  );
  const stagedFiles = createMemo<FileDiff[]>(() => staged().map(toFileDiff));

  // Tree is rebuilt independently inside FileList for rendering; we recompute
  // here only to derive the dir-paths set the shared Expand/Collapse All
  // actions need (the toolbar lives outside FileList for working-tree view,
  // so it can't reach into the widget's internal memo). Cost: O(N) per side
  // per status refresh — negligible relative to the IPC round-trip.
  const unstagedDirPaths = createMemo(() =>
    collectDirPaths(buildTreeFromPaths(unstagedFiles())),
  );
  const stagedDirPaths = createMemo(() =>
    collectDirPaths(buildTreeFromPaths(stagedFiles())),
  );

  const isTree = () => displayTree(repoId());

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

  const activeFor = (
    side: "unstaged" | "staged",
  ): string | undefined => {
    const sel = selectedDiffFile();
    if (sel?.kind !== "staging" || sel.side !== side) return undefined;
    return sel.path;
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

  // Shared toolbar fires Expand/Collapse All for both sections at once so
  // the widget action surface stays single-source-of-truth across the
  // working-tree view. Tree/Flat mode and filter are already shared via the
  // per-repo persisted store.
  const onExpandAllSections = () => {
    expandAllDirs(repoId(), UNSTAGED_REV, isTree());
    expandAllDirs(repoId(), STAGED_REV, isTree());
  };
  const onCollapseAllSections = () => {
    collapseAllDirs(repoId(), UNSTAGED_REV, isTree(), unstagedDirPaths());
    collapseAllDirs(repoId(), STAGED_REV, isTree(), stagedDirPaths());
  };

  return (
    <div class="commit-panel">
      <div class="commit-panel__header">
        <Tooltip text="Back to commit details">
          <button
            class="commit-panel__back"
            type="button"
            onClick={() => props.onBack()}
          >
            ← Back
          </button>
        </Tooltip>
        <span class="commit-panel__heading">
          {totalChanges()} file change{totalChanges() === 1 ? "" : "s"} in
          working directory
        </span>
      </div>

      <Show when={totalChanges() === 0}>
        <p class="inspector__empty">Working tree is clean.</p>
      </Show>

      <Show when={totalChanges() > 0}>
        <FileListToolbar
          repoId={repoId()}
          allExpanded={
            !hasAnyCollapsed(repoId(), UNSTAGED_REV, isTree()) &&
            !hasAnyCollapsed(repoId(), STAGED_REV, isTree())
          }
          onExpandAll={onExpandAllSections}
          onCollapseAll={onCollapseAllSections}
        />
      </Show>

      <section class="commit-panel__section" data-side="unstaged">
        <header class="commit-panel__section-header">
          <Tooltip text={unstagedFilesCollapsed() ? "Expand" : "Collapse"}>
            <button
              class="commit-panel__section-toggle"
              type="button"
              aria-expanded={!unstagedFilesCollapsed()}
              onClick={() => setUnstagedFilesCollapsed((v) => !v)}
            >
              <span
                class="commit-panel__section-chevron"
                data-collapsed={unstagedFilesCollapsed() ? "true" : "false"}
              >
                ▸
              </span>
              <span class="commit-panel__section-title">Unstaged Files</span>
              <span class="commit-panel__section-count">
                {unstaged().length}
              </span>
            </button>
          </Tooltip>
          <Show when={unstaged().length > 0}>
            <Tooltip text="Stage All Changes">
              <button
                class="commit-panel__bulk"
                type="button"
                onClick={() => props.onStageAll()}
              >
                Stage All Changes
              </button>
            </Tooltip>
          </Show>
        </header>
        <Show when={!unstagedFilesCollapsed() && unstaged().length > 0}>
          <FileList
            repoId={repoId()}
            revKey={UNSTAGED_REV}
            listType="unstaged"
            files={unstagedFiles()}
            activeFilePath={activeFor("unstaged")}
            onSelectFile={(p) => openStagingDiffTab("unstaged", p)}
            rowActions={unstagedActions}
            hideToolbar
          />
        </Show>
      </section>

      <section class="commit-panel__section" data-side="staged">
        <header class="commit-panel__section-header">
          <Tooltip text={stagedFilesCollapsed() ? "Expand" : "Collapse"}>
            <button
              class="commit-panel__section-toggle"
              type="button"
              aria-expanded={!stagedFilesCollapsed()}
              onClick={() => setStagedFilesCollapsed((v) => !v)}
            >
              <span
                class="commit-panel__section-chevron"
                data-collapsed={stagedFilesCollapsed() ? "true" : "false"}
              >
                ▸
              </span>
              <span class="commit-panel__section-title">Staged Files</span>
              <span class="commit-panel__section-count">{staged().length}</span>
            </button>
          </Tooltip>
          <Show when={staged().length > 0}>
            <Tooltip text="Unstage All Changes">
              <button
                class="commit-panel__bulk"
                type="button"
                onClick={() => props.onUnstageAll()}
              >
                Unstage All Changes
              </button>
            </Tooltip>
          </Show>
        </header>
        <Show when={!stagedFilesCollapsed() && staged().length > 0}>
          <FileList
            repoId={repoId()}
            revKey={STAGED_REV}
            listType="staged"
            files={stagedFiles()}
            activeFilePath={activeFor("staged")}
            onSelectFile={(p) => openStagingDiffTab("staged", p)}
            rowActions={stagedActions}
            hideToolbar
          />
        </Show>
      </section>

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
                <Tooltip text="libgit2 never runs hooks; this flag is plumbed for future gix migration">
                  <span class="commit-panel__option-hint">
                    (no-op on current backend)
                  </span>
                </Tooltip>
              </label>
              <label class="commit-panel__option" data-disabled="true">
                <input type="checkbox" disabled />
                <span>Sign with GPG</span>
                <Tooltip text="GPG signing is not yet wired — tracked in a separate issue">
                  <span class="commit-panel__option-hint">(coming soon)</span>
                </Tooltip>
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
