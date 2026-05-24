// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createSignal, For, Show } from "solid-js";

import { Dialog } from "../Dialog";
import { openConflictDialog } from "../ConflictResolverDialog/state";
import {
  closeRebaseInteractiveDialog,
  rebaseInteractiveDialog,
} from "./state";
import type { RebaseActionKind } from "../../ipc";
import "./style.css";

const ACTION_LABELS: Record<RebaseActionKind, string> = {
  pick: "Pick",
  reword: "Reword",
  edit: "Edit",
  squash: "Squash",
  fixup: "Fixup",
  drop: "Drop",
};

const ACTION_HINTS: Record<RebaseActionKind, string> = {
  pick: "Reapply this commit as-is.",
  reword: "Reapply the commit with a new message.",
  edit: "Pause after applying so you can amend before continuing.",
  squash: "Combine into the previous commit, joining both messages.",
  fixup: "Combine into the previous commit, discarding this message.",
  drop: "Skip this commit entirely.",
};

export function RebaseInteractiveDialog() {
  const [dragFromIdx, setDragFromIdx] = createSignal<number | null>(null);
  const [dropOverIdx, setDropOverIdx] = createSignal<number | null>(null);

  const dialogTitle = createMemo(() =>
    rebaseInteractiveDialog.state() ? "Interactive Rebase — in progress" : "Interactive Rebase",
  );

  function onDragStart(idx: number, e: DragEvent) {
    setDragFromIdx(idx);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
    }
  }

  function onDragOver(idx: number, e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setDropOverIdx(idx);
  }

  function onDrop(idx: number, e: DragEvent) {
    e.preventDefault();
    const from = dragFromIdx();
    setDragFromIdx(null);
    setDropOverIdx(null);
    if (from === null || from === idx) return;
    rebaseInteractiveDialog.reorder(from, idx);
  }

  function onDragEnd() {
    setDragFromIdx(null);
    setDropOverIdx(null);
  }

  return (
    <Dialog
      open={rebaseInteractiveDialog.open()}
      title={dialogTitle()}
      onClose={closeRebaseInteractiveDialog}
      size="wide"
      dismissOnBackdrop={false}
      footer={<DialogFooter />}
    >
      <Show when={rebaseInteractiveDialog.error()}>
        <div class="rebase-error" role="alert">
          {rebaseInteractiveDialog.error()}
        </div>
      </Show>

      <Show when={rebaseInteractiveDialog.state()} fallback={<PickerView
        dragFromIdx={dragFromIdx()}
        dropOverIdx={dropOverIdx()}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      />}>
        <ProgressView />
      </Show>
    </Dialog>
  );
}

interface PickerViewProps {
  dragFromIdx: number | null;
  dropOverIdx: number | null;
  onDragStart: (idx: number, e: DragEvent) => void;
  onDragOver: (idx: number, e: DragEvent) => void;
  onDrop: (idx: number, e: DragEvent) => void;
  onDragEnd: () => void;
}

function PickerView(props: PickerViewProps) {
  const activeCount = createMemo(
    () => rebaseInteractiveDialog.rows().filter((r) => r.action !== "drop").length,
  );

  return (
    <div class="rebase-picker">
      <p class="rebase-subtitle">
        Rebasing {activeCount()} commit(s) onto {rebaseInteractiveDialog.ontoLabel() ?? "target"}.
        Drag rows to reorder. The first row is applied first.
      </p>

      <ul class="rebase-rows">
        <For each={rebaseInteractiveDialog.rows()}>
          {(row, idx) => (
            <li
              class="rebase-row"
              classList={{
                "rebase-row--dragging": props.dragFromIdx === idx(),
                "rebase-row--drop-over": props.dropOverIdx === idx(),
                "rebase-row--drop": row.action === "drop",
              }}
              draggable={true}
              onDragStart={(e) => props.onDragStart(idx(), e)}
              onDragOver={(e) => props.onDragOver(idx(), e)}
              onDrop={(e) => props.onDrop(idx(), e)}
              onDragEnd={() => props.onDragEnd()}
            >
              <span class="rebase-handle" aria-hidden="true">
                ⠿
              </span>
              <code class="rebase-oid">{row.short_oid}</code>
              <select
                class="rebase-action"
                value={row.action}
                onChange={(e) =>
                  rebaseInteractiveDialog.setAction(
                    idx(),
                    e.currentTarget.value as RebaseActionKind,
                  )
                }
                title={ACTION_HINTS[row.action]}
              >
                <For each={Object.entries(ACTION_LABELS) as [RebaseActionKind, string][]}>
                  {([key, label]) => <option value={key}>{label}</option>}
                </For>
              </select>
              <span class="rebase-summary">{row.summary}</span>
              <Show when={row.action === "reword"}>
                <input
                  class="rebase-reword"
                  type="text"
                  placeholder="New message"
                  value={row.new_message}
                  onInput={(e) =>
                    rebaseInteractiveDialog.setRowMessage(idx(), e.currentTarget.value)
                  }
                />
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function ProgressView() {
  const stateRow = createMemo(() => rebaseInteractiveDialog.state());
  const total = createMemo(() => stateRow()?.steps.length ?? 0);
  const current = createMemo(() => stateRow()?.current_step ?? 0);

  return (
    <div class="rebase-progress">
      <p class="rebase-subtitle">
        Step {current() + (current() < total() ? 1 : 0)} of {total()}.
        <Show when={stateRow()?.pause_reason === "edit"}>
          {" "}
          Paused for <strong>edit</strong> — amend the worktree, then continue.
        </Show>
        <Show when={stateRow()?.pause_reason === "conflict"}>
          {" "}
          Paused on a <strong>conflict</strong>. Resolve and stage the changes, then continue.
        </Show>
      </p>
      <Show when={stateRow()?.pause_reason === "conflict"}>
        <button
          type="button"
          class="dialog-btn dialog-btn--secondary"
          onClick={() => {
            const repo = rebaseInteractiveDialog.repoPath();
            if (repo) openConflictDialog({ repoPath: repo });
          }}
        >
          Open Conflict Resolver
        </button>
      </Show>
      <ol class="rebase-step-list">
        <For each={stateRow()?.steps ?? []}>
          {(step, idx) => (
            <li
              classList={{
                "rebase-step--done": idx() < current(),
                "rebase-step--current": idx() === current(),
              }}
            >
              <code class="rebase-oid">{step.oid.slice(0, 7)}</code>
              <span class="rebase-action-label">{ACTION_LABELS[step.action]}</span>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}

function DialogFooter() {
  return (
    <Show
      when={rebaseInteractiveDialog.state()}
      fallback={
        <>
          <button
            type="button"
            class="dialog-btn dialog-btn--secondary"
            onClick={closeRebaseInteractiveDialog}
            disabled={rebaseInteractiveDialog.submitting()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="dialog-btn dialog-btn--primary"
            onClick={() => void rebaseInteractiveDialog.submit()}
            disabled={
              rebaseInteractiveDialog.submitting() ||
              rebaseInteractiveDialog.rows().length === 0
            }
          >
            Yes, Start Rebase
          </button>
        </>
      }
    >
      <button
        type="button"
        class="dialog-btn dialog-btn--danger"
        onClick={() => void rebaseInteractiveDialog.abortRun()}
        disabled={rebaseInteractiveDialog.submitting()}
      >
        Abort Rebase
      </button>
      <button
        type="button"
        class="dialog-btn dialog-btn--secondary"
        onClick={() => void rebaseInteractiveDialog.skipRun()}
        disabled={rebaseInteractiveDialog.submitting()}
      >
        Skip Commit
      </button>
      <button
        type="button"
        class="dialog-btn dialog-btn--primary"
        onClick={() => void rebaseInteractiveDialog.continueRun()}
        disabled={rebaseInteractiveDialog.submitting()}
      >
        Continue Rebase
      </button>
    </Show>
  );
}
