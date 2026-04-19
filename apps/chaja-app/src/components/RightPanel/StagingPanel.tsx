// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, For, on, Show } from "solid-js";

import {
  getHeadCommitMessage,
  type WorkingTreeChange,
  type WorkingTreeStatus,
} from "../../ipc";
import {
  amendEnabled,
  commitDescription,
  commitMessage,
  openStagingDiffTab,
  repoPath,
  selectedDiffFile,
  setAmendEnabled,
  setCommitDescription,
  setCommitMessage,
} from "../../state";
import { statusTone } from "./statusTone";

const SUBJECT_LIMIT = 72;

const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "docs",
  "chore",
  "refactor",
  "test",
  "ci",
  "style",
  "perf",
  "build",
  "revert",
] as const;

function applyConventionalPrefix(current: string, type: string): string {
  // Strip any existing "<type>: " or "<type>(scope): " prefix, then inject.
  const stripped = current.replace(/^[a-z]+(\([^)]*\))?:\s*/i, "");
  return `${type}: ${stripped}`;
}

export interface StagingPanelProps {
  status: WorkingTreeStatus | undefined;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onBack: () => void;
  onCommit: () => void;
}

export function StagingPanel(props: StagingPanelProps) {
  const unstaged = () => props.status?.unstaged ?? [];
  const staged = () => props.status?.staged ?? [];
  const stagedCount = () => staged().length;
  const canCommit = () =>
    (stagedCount() > 0 || amendEnabled()) &&
    commitMessage().trim().length > 0;
  const remaining = () => SUBJECT_LIMIT - commitMessage().length;
  const totalChanges = () => unstaged().length + staged().length;

  // When the user toggles Amend on, pre-fill the summary/description from
  // HEAD's message. When toggled off, clear the fields. User edits in between
  // aren't touched.
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
      { defer: true }
    )
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

  return (
    <div class="staging">
      <div class="staging__header">
        <button
          class="staging__back"
          type="button"
          title="Back to commit details"
          onClick={() => props.onBack()}
        >
          ← Back
        </button>
        <span class="staging__heading">
          {totalChanges()} file change{totalChanges() === 1 ? "" : "s"} in working directory
        </span>
      </div>

      <Show when={totalChanges() === 0}>
        <p class="inspector__empty">Working tree is clean.</p>
      </Show>

      <StagingSection
        title="Unstaged Files"
        side="unstaged"
        changes={unstaged()}
        actionLabel="Stage"
        bulkActionLabel="Stage All"
        onBulkAction={() => props.onStage(unstaged().map((c) => c.path))}
        onRowAction={(path) => props.onStage([path])}
        isActive={(path) => isActive("unstaged", path)}
      />

      <StagingSection
        title="Staged Files"
        side="staged"
        changes={staged()}
        actionLabel="Unstage"
        bulkActionLabel="Unstage All"
        onBulkAction={() => props.onUnstage(staged().map((c) => c.path))}
        onRowAction={(path) => props.onUnstage([path])}
        isActive={(path) => isActive("staged", path)}
      />

      <section class="staging__commit-form">
        <header class="staging__commit-form__header">
          <span>Commit</span>
          <label class="staging__commit-form__amend">
            <input
              type="checkbox"
              checked={amendEnabled()}
              onInput={(e) => setAmendEnabled(e.currentTarget.checked)}
            />
            <span>Amend previous commit</span>
          </label>
        </header>
        <div class="staging__commit-form__template">
          <label for="staging-template">Template</label>
          <select
            id="staging-template"
            class="staging__commit-form__template-select"
            value=""
            onChange={(e) => {
              const t = e.currentTarget.value;
              if (!t) return;
              setCommitMessage(applyConventionalPrefix(commitMessage(), t));
              e.currentTarget.value = "";
            }}
          >
            <option value="">Conventional…</option>
            <For each={CONVENTIONAL_TYPES}>
              {(t) => <option value={t}>{t}</option>}
            </For>
          </select>
        </div>
        <label class="staging__commit-form__field">
          <div class="staging__commit-form__label-row">
            <span>Commit summary</span>
            <span
              class="staging__commit-form__counter"
              data-overflow={remaining() < 0 ? "true" : "false"}
            >
              {remaining()}
            </span>
          </div>
          <input
            class="staging__commit-form__input"
            type="text"
            placeholder="Summary"
            value={commitMessage()}
            onInput={(e) => setCommitMessage(e.currentTarget.value)}
          />
        </label>
        <label class="staging__commit-form__field">
          <span>Description</span>
          <textarea
            class="staging__commit-form__textarea"
            placeholder="Optional body"
            rows="3"
            value={commitDescription()}
            onInput={(e) => setCommitDescription(e.currentTarget.value)}
          />
        </label>
        <button
          class="staging__commit-form__submit"
          type="button"
          disabled={!canCommit()}
          onClick={() => props.onCommit()}
          title={submitTitle()}
          data-mode={amendEnabled() ? "amend" : "commit"}
        >
          {submitLabel()}
        </button>
      </section>
    </div>
  );
}

interface StagingSectionProps {
  title: string;
  side: "unstaged" | "staged";
  changes: WorkingTreeChange[];
  actionLabel: string;
  bulkActionLabel: string;
  onBulkAction: () => void;
  onRowAction: (path: string) => void;
  isActive: (path: string) => boolean;
}

function StagingSection(props: StagingSectionProps) {
  return (
    <section class="staging__section" data-side={props.side}>
      <header class="staging__section-header">
        <span class="staging__section-title">{props.title}</span>
        <span class="staging__section-count">{props.changes.length}</span>
        <Show when={props.changes.length > 0}>
          <button
            class="staging__stage-all"
            type="button"
            title={props.bulkActionLabel}
            onClick={() => props.onBulkAction()}
          >
            {props.bulkActionLabel}
          </button>
        </Show>
      </header>
      <ul class="staging__list">
        <For each={props.changes}>
          {(c) => (
            <StagingRow
              change={c}
              side={props.side}
              active={props.isActive(c.path)}
              onClick={() => openStagingDiffTab(props.side, c.path)}
              onAction={() => props.onRowAction(c.path)}
              actionLabel={props.actionLabel}
            />
          )}
        </For>
      </ul>
    </section>
  );
}

interface StagingRowProps {
  change: WorkingTreeChange;
  side: "unstaged" | "staged";
  active: boolean;
  onClick: () => void;
  onAction: () => void;
  actionLabel: string;
}

function StagingRow(props: StagingRowProps) {
  const tone = () => statusTone(props.change.status);
  return (
    <li>
      <div
        class="staging__row"
        data-active={props.active ? "true" : "false"}
        data-side={props.side}
      >
        <button
          class="staging__row-main"
          type="button"
          title={props.change.path}
          onClick={() => props.onClick()}
        >
          <span class="changed-files__status" data-tone={tone().tone}>
            {tone().label}
          </span>
          <Show when={props.change.old_path}>
            <span class="changed-files__old">{props.change.old_path} →</span>
          </Show>
          <span class="changed-files__path">{props.change.path}</span>
        </button>
        <button
          class="staging__row-action"
          type="button"
          title={props.actionLabel}
          onClick={(e) => {
            e.stopPropagation();
            props.onAction();
          }}
        >
          {props.actionLabel}
        </button>
      </div>
    </li>
  );
}
