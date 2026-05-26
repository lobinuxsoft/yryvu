// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-file history panel (issue #7).
 *
 * Two-pane layout:
 *   - Left: virtualized commit list filtered to ones that touched the
 *     file (with rename detection). Click → loads that commit's diff
 *     for the file into the right pane.
 *   - Right: standard `DiffFileBlock` rendering. "Checkout this
 *     version" action surfaces in the panel header when a commit is
 *     selected.
 */

import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js";

import {
  checkoutFileAt,
  getCommitDiff,
  getFileHistory,
  type FileDiff,
  type FileHistoryEntry,
} from "../../ipc";
import {
  closeFileHistory,
  refreshWorkingTree,
  repoPath,
  selectedHistoryFile,
} from "../../state";
import { Dialog } from "../Dialog";
import { DiffFileBlock } from "../DiffView";
import { notify } from "../Notifications";
import { Tooltip } from "../Tooltip";

const ROW_PX = 56;

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusGlyph(status: FileHistoryEntry["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    default:
      return "·";
  }
}

export function FileHistoryPanel(): JSX.Element {
  let listRef: HTMLDivElement | undefined;
  const [selectedSha, setSelectedSha] = createSignal<string | undefined>(
    undefined,
  );
  const [pendingCheckout, setPendingCheckout] = createSignal(false);

  const args = createMemo(() => {
    const repo = repoPath();
    const path = selectedHistoryFile();
    return repo && path ? ([repo, path] as const) : undefined;
  });

  const [history] = createResource<FileHistoryEntry[], readonly [string, string]>(
    args,
    async ([repo, path]) => {
      const entries = await getFileHistory(repo, path);
      // Auto-select newest commit so the right pane has something to
      // show on first open.
      if (entries.length > 0) setSelectedSha(entries[0].sha);
      return entries;
    },
  );

  const virtualizer = createVirtualizer({
    get count() {
      return history()?.length ?? 0;
    },
    getScrollElement: () => listRef ?? null,
    estimateSize: () => ROW_PX,
    overscan: 6,
  });

  const [diffPreview] = createResource<FileDiff | undefined, readonly [string, string, string]>(
    () => {
      const repo = repoPath();
      const path = selectedHistoryFile();
      const sha = selectedSha();
      return repo && path && sha ? ([repo, path, sha] as const) : undefined;
    },
    async ([repo, _path, sha]) => {
      const commit = await getCommitDiff(repo, sha);
      // The history-tracked path may differ from the commit's pathspec
      // when a rename happened — match by either the new path or the
      // commit-side rename oldpath.
      const target = selectedHistoryFile();
      return commit.files.find(
        (f) => f.path === target || f.old_path === target,
      );
    },
  );

  async function confirmCheckout() {
    setPendingCheckout(false);
    const repo = repoPath();
    const path = selectedHistoryFile();
    const sha = selectedSha();
    if (!repo || !path || !sha) return;
    try {
      await checkoutFileAt(repo, path, sha);
      notify.info("File restored", {
        message: `${path} restored to ${sha.slice(0, 7)}.`,
        category: "commit",
      });
      refreshWorkingTree();
    } catch (err) {
      notify.error("Checkout failed", {
        message: String(err),
        category: "commit",
      });
    }
  }

  return (
    <div class="file-history-panel">
      <header class="file-history-panel__header">
        <span class="file-history-panel__title">History · </span>
        <span class="file-history-panel__path">{selectedHistoryFile()}</span>
        <span class="file-history-panel__count">
          <Show when={history()}>{history()!.length} commits</Show>
        </span>
        <Tooltip text="Restore this file to the selected commit">
          <button
            class="file-history-panel__action"
            type="button"
            disabled={!selectedSha()}
            onClick={() => setPendingCheckout(true)}
          >
            Restore to this commit
          </button>
        </Tooltip>
        <Tooltip text="Close history">
          <button
            class="file-history-panel__close"
            type="button"
            aria-label="Close history"
            onClick={() => closeFileHistory()}
          >
            ×
          </button>
        </Tooltip>
      </header>

      <div class="file-history-panel__body">
        <div class="file-history-panel__list" ref={listRef}>
          <Show when={history.loading}>
            <div class="file-history-panel__status">Loading history…</div>
          </Show>
          <Show when={history() && history()!.length === 0}>
            <div class="file-history-panel__status">No commits found.</div>
          </Show>
          <Show when={history() && history()!.length > 0}>
            <div
              class="file-history-panel__sizer"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              <For each={virtualizer.getVirtualItems()}>
                {(row) => {
                  const entry = () => history()![row.index];
                  const active = () => selectedSha() === entry().sha;
                  return (
                    <button
                      class="file-history-row"
                      type="button"
                      data-active={active()}
                      style={{
                        transform: `translateY(${row.start}px)`,
                        height: `${ROW_PX}px`,
                      }}
                      onClick={() => setSelectedSha(entry().sha)}
                    >
                      <span
                        class="file-history-row__status"
                        data-tone={entry().status}
                      >
                        {statusGlyph(entry().status)}
                      </span>
                      <span class="file-history-row__summary">
                        {entry().summary}
                      </span>
                      <span class="file-history-row__meta">
                        <span class="file-history-row__author">
                          {entry().authorName}
                        </span>
                        <span class="file-history-row__date">
                          {formatDate(entry().time)}
                        </span>
                        <span class="file-history-row__sha">
                          {entry().shortSha}
                        </span>
                      </span>
                      <Show when={entry().renamedFrom}>
                        <span class="file-history-row__renamed">
                          ← {entry().renamedFrom}
                        </span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>

        <div class="file-history-panel__preview">
          <Show when={diffPreview.loading}>
            <div class="file-history-panel__status">Loading diff…</div>
          </Show>
          <Show when={diffPreview() && !diffPreview.loading}>
            <DiffFileBlock
              file={diffPreview()!}
              headless
              alwaysExpanded
              viewMode="hunk"
            />
          </Show>
          <Show when={!diffPreview() && !diffPreview.loading && selectedSha()}>
            <div class="file-history-panel__status">
              File not modified in this commit (parent diff is empty).
            </div>
          </Show>
        </div>
      </div>

      <Dialog
        open={pendingCheckout()}
        title="Restore file to this commit?"
        onClose={() => setPendingCheckout(false)}
        footer={
          <>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={() => setPendingCheckout(false)}
            >
              Cancel
            </button>
            <button
              class="dialog__btn dialog__btn--danger"
              type="button"
              onClick={() => void confirmCheckout()}
            >
              Restore
            </button>
          </>
        }
      >
        <p>
          This will overwrite uncommitted changes to{" "}
          <code>{selectedHistoryFile()}</code> with the content at{" "}
          <code>{selectedSha()?.slice(0, 7)}</code>.
        </p>
        <p class="dialog__warning">This action cannot be undone.</p>
      </Dialog>
    </div>
  );
}
