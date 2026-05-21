// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, For, Show } from "solid-js";

import { Dialog } from "../Dialog";
import { closeConflictDialog, conflictDialog } from "./state";
import "./style.css";

const SOURCE_LABELS: Record<string, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "interactive-rebase": "Interactive Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  bisect: "Bisect",
  standalone: "Standalone",
};

export function ConflictResolverDialog() {
  const dialogTitle = createMemo(() => {
    const src = conflictDialog.source();
    return `Resolve Conflicts — ${SOURCE_LABELS[src] ?? src}`;
  });

  const remainingCount = createMemo(() => conflictDialog.files().length);

  return (
    <Dialog
      open={conflictDialog.open()}
      title={dialogTitle()}
      onClose={closeConflictDialog}
      size="wide"
      dismissOnBackdrop={false}
      bodyClass="conflict-dialog-body"
      footer={<DialogFooter />}
    >
      <Show when={conflictDialog.error()}>
        <div class="conflict-error" role="alert">
          {conflictDialog.error()}
        </div>
      </Show>

      <div class="conflict-layout">
        <FileList />
        <ResolverPane />
      </div>

      <Show when={remainingCount() === 0}>
        <p class="conflict-clear">All conflicts resolved. Ready to finish.</p>
      </Show>
    </Dialog>
  );
}

function FileList() {
  return (
    <aside class="conflict-files">
      <h4>Conflicted files ({conflictDialog.files().length})</h4>
      <Show when={conflictDialog.files().length === 0}>
        <p class="conflict-files-empty">No remaining conflicts.</p>
      </Show>
      <ul>
        <For each={conflictDialog.files()}>
          {(file) => (
            <li
              classList={{
                "conflict-files-row": true,
                "conflict-files-row--active": conflictDialog.activePath() === file.path,
              }}
              onClick={() => void conflictDialog.selectFile(file.path)}
            >
              <span class="conflict-files-path" title={file.path}>
                {file.path}
              </span>
              <span class="conflict-files-stages">
                <Show when={!file.has_ancestor}>
                  <span title="No base (add/add)">·B</span>
                </Show>
                <Show when={!file.has_ours}>
                  <span title="No ours (deleted on our side)">·O</span>
                </Show>
                <Show when={!file.has_theirs}>
                  <span title="No theirs (deleted on their side)">·T</span>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>
    </aside>
  );
}

function ResolverPane() {
  return (
    <Show when={conflictDialog.activePath()} fallback={<EmptyPane />}>
      <section class="conflict-resolver">
        <header class="conflict-actions">
          <button
            type="button"
            class="dialog-btn dialog-btn--secondary"
            onClick={() => void conflictDialog.acceptSide("ours")}
            disabled={conflictDialog.busy() || !conflictDialog.diff3()?.ours}
          >
            Use Ours
          </button>
          <button
            type="button"
            class="dialog-btn dialog-btn--secondary"
            onClick={() => void conflictDialog.acceptSide("base")}
            disabled={conflictDialog.busy() || !conflictDialog.diff3()?.base}
          >
            Use Base
          </button>
          <button
            type="button"
            class="dialog-btn dialog-btn--secondary"
            onClick={() => void conflictDialog.acceptSide("theirs")}
            disabled={conflictDialog.busy() || !conflictDialog.diff3()?.theirs}
          >
            Use Theirs
          </button>
          <span class="conflict-actions-spacer" />
          <button
            type="button"
            class="dialog-btn dialog-btn--secondary"
            onClick={() => void conflictDialog.markFromWorktree()}
            disabled={conflictDialog.busy()}
            title="Stage the current worktree content as resolved (rejects leftover markers)."
          >
            Mark Resolved
          </button>
          <button
            type="button"
            class="dialog-btn dialog-btn--primary"
            onClick={() => void conflictDialog.saveOutput()}
            disabled={conflictDialog.busy()}
          >
            Save Resolved
          </button>
        </header>

        <div class="conflict-diff3">
          <DiffColumn title="Ours" content={conflictDialog.diff3()?.ours} />
          <OutputColumn />
          <DiffColumn title="Theirs" content={conflictDialog.diff3()?.theirs} />
        </div>

        <Show when={conflictDialog.diff3()?.base !== undefined && conflictDialog.diff3()?.base !== null}>
          <details class="conflict-base">
            <summary>Common ancestor (base)</summary>
            <pre>{conflictDialog.diff3()?.base ?? ""}</pre>
          </details>
        </Show>
      </section>
    </Show>
  );
}

interface DiffColumnProps {
  title: string;
  content: string | null | undefined;
}

function DiffColumn(props: DiffColumnProps) {
  return (
    <div class="conflict-col">
      <h5>{props.title}</h5>
      <pre class="conflict-col-content">
        {props.content ?? "(missing — file deleted on this side)"}
      </pre>
    </div>
  );
}

function OutputColumn() {
  return (
    <div class="conflict-col conflict-col--output">
      <h5>Output (working)</h5>
      <textarea
        class="conflict-col-editor"
        value={conflictDialog.editedOutput()}
        onInput={(e) => conflictDialog.setEditedOutput(e.currentTarget.value)}
        spellcheck={false}
        wrap="off"
      />
    </div>
  );
}

function EmptyPane() {
  return (
    <section class="conflict-resolver conflict-resolver--empty">
      <p>No file selected — pick one from the list to start resolving.</p>
    </section>
  );
}

function DialogFooter() {
  return (
    <>
      <button
        type="button"
        class="dialog-btn dialog-btn--secondary"
        onClick={closeConflictDialog}
        disabled={conflictDialog.busy()}
      >
        Close
      </button>
      <button
        type="button"
        class="dialog-btn dialog-btn--primary"
        onClick={() => void conflictDialog.finish()}
        disabled={conflictDialog.busy() || conflictDialog.files().length > 0}
        title={
          conflictDialog.files().length > 0
            ? "Resolve every file before finishing."
            : "Commit the resolved tree and exit the in-progress op."
        }
      >
        Finish
      </button>
    </>
  );
}
