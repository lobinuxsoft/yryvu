// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, createResource, Show } from "solid-js";

import {
  discardHunks,
  getCommitDiff,
  getStagedDiff,
  getUnstagedDiff,
  stageHunks,
  unstageHunks,
  type FileDiff,
} from "../../ipc";
import {
  closeDiffTab,
  refreshWorkingTree,
  repoPath,
  selectedDiffFile,
  workingTreeNonce,
} from "../../state";
import { Dialog } from "../Dialog";
import { DiffFileBlock, type HunkStagingActions } from "../DiffView";
import { notify } from "../Notifications";
import { Tooltip } from "../Tooltip";

async function loadDiff(
  repo: string,
  selection: NonNullable<ReturnType<typeof selectedDiffFile>>
): Promise<FileDiff | undefined> {
  if (selection.kind === "commit") {
    const commit = await getCommitDiff(repo, selection.sha);
    return commit.files.find((f) => f.path === selection.path);
  }
  if (selection.side === "unstaged") {
    return await getUnstagedDiff(repo, selection.path);
  }
  return await getStagedDiff(repo, selection.path);
}

type DiffSource = [string, NonNullable<ReturnType<typeof selectedDiffFile>>, number];

export function FileDiffTab() {
  const [file] = createResource<FileDiff | undefined, DiffSource>(
    (): DiffSource | undefined => {
      const p = repoPath();
      const sel = selectedDiffFile();
      if (!p || !sel) return undefined;
      return [p, sel, workingTreeNonce()];
    },
    async ([p, sel]) => await loadDiff(p, sel)
  );

  // Hunk index queued for destructive discard. `null` = dialog closed.
  const [pendingDiscardHunk, setPendingDiscardHunk] = createSignal<
    number | null
  >(null);

  const selection = () => selectedDiffFile();
  const targetPath = () => selection()?.path;

  async function handleHunkOp(
    op: (
      p: string,
      path: string,
      hunkIndices: number[],
    ) => Promise<void>,
    failTitle: string,
    hunkIndex: number,
  ) {
    const p = repoPath();
    const sel = selection();
    if (!p || !sel || sel.kind !== "staging") return;
    try {
      await op(p, sel.path, [hunkIndex]);
    } catch (err) {
      notify.error(failTitle, {
        message: String(err),
        category: "commit",
      });
    }
    refreshWorkingTree();
  }

  function stagingActions(): HunkStagingActions | undefined {
    const sel = selection();
    if (!sel || sel.kind !== "staging") return undefined;
    return {
      side: sel.side,
      onStageHunk: (i) => handleHunkOp(stageHunks, "Stage hunk failed", i),
      onUnstageHunk: (i) =>
        handleHunkOp(unstageHunks, "Unstage hunk failed", i),
      onDiscardHunk: (i) => setPendingDiscardHunk(i),
    };
  }

  async function confirmDiscardHunk() {
    const idx = pendingDiscardHunk();
    setPendingDiscardHunk(null);
    if (idx === null) return;
    await handleHunkOp(discardHunks, "Discard hunk failed", idx);
  }

  const discardHunkHeader = () => {
    const idx = pendingDiscardHunk();
    if (idx === null) return "";
    const hunk = file()?.hunks[idx];
    return hunk?.header ?? "";
  };

  const subtitle = () => {
    const sel = selection();
    if (!sel) return null;
    if (sel.kind === "commit") {
      return (
        <span class="file-diff-tab__commit">
          in <code>{sel.sha.slice(0, 7)}</code>
        </span>
      );
    }
    return (
      <span class="file-diff-tab__commit">
        {sel.side === "unstaged" ? "unstaged" : "staged"}
      </span>
    );
  };

  return (
    <div class="file-diff-tab">
      <header class="file-diff-tab__header">
        <span class="file-diff-tab__path">{targetPath()}</span>
        {subtitle()}
        <Tooltip text="Close diff (return to graph)">
          <button
            class="file-diff-tab__close"
            type="button"
            aria-label="Close diff"
            onClick={() => closeDiffTab()}
          >
            ×
          </button>
        </Tooltip>
      </header>

      <div class="file-diff-tab__body">
        <Show when={file.loading}>
          <div class="file-diff-tab__status">Loading diff…</div>
        </Show>
        <Show when={file.error}>
          <div class="file-diff-tab__error">{String(file.error)}</div>
        </Show>
        <Show when={file() && !file.loading && !file.error}>
          <Show
            when={file()}
            fallback={
              <div class="file-diff-tab__status">
                No diff available for <code>{targetPath()}</code>.
              </div>
            }
          >
            <DiffFileBlock
              file={file()!}
              headless
              alwaysExpanded
              viewMode="split"
              stagingActions={stagingActions()}
            />
          </Show>
        </Show>
      </div>

      <Dialog
        open={pendingDiscardHunk() !== null}
        title="Discard hunk changes?"
        onClose={() => setPendingDiscardHunk(null)}
        footer={
          <>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={() => setPendingDiscardHunk(null)}
            >
              Cancel
            </button>
            <button
              class="dialog__btn dialog__btn--danger"
              type="button"
              onClick={() => void confirmDiscardHunk()}
            >
              Discard
            </button>
          </>
        }
      >
        <p>
          This will permanently discard unstaged changes to{" "}
          <code>{targetPath()}</code>
          <Show when={discardHunkHeader()}>
            {" "}
            in hunk <code>{discardHunkHeader()}</code>
          </Show>
          . Are you sure you want to continue?
        </p>
        <p class="dialog__warning">This action cannot be undone.</p>
      </Dialog>
    </div>
  );
}
