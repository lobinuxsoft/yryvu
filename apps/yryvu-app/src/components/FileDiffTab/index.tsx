// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createEffect,
  createMemo,
  createSignal,
  createResource,
  onCleanup,
  Show,
} from "solid-js";

import {
  discardHunks,
  getCommitDiff,
  getFileBlame,
  getStagedDiff,
  getUnstagedDiff,
  readFileContent,
  stageHunks,
  stageLines,
  unstageHunks,
  unstageLines,
  type FileBlame,
  type FileContent,
  type FileContentSource,
  type FileDiff,
} from "../../ipc";
import {
  clearDiffNavigator,
  closeDiffTab,
  fileViewMode,
  refreshWorkingTree,
  repoPath,
  selectedDiffFile,
  setDiffNavigator,
  setSelectedCommit,
  workingTreeNonce,
} from "../../state";
import { Dialog } from "../Dialog";
import {
  DiffFileBlock,
  type HunkStagingActions,
  type ImageSources,
  type LineStagingApi,
} from "../DiffView";
import { DiffToolbar } from "../DiffToolbar";
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

/// Pick the "after" side of the diff for full-file fetches (INLINE +
/// CONTENT modes). Working tree for unstaged edits, index for staged
/// entries, the commit blob itself for commit selections.
function selectionContentSource(
  selection: NonNullable<ReturnType<typeof selectedDiffFile>>
): FileContentSource {
  if (selection.kind === "commit") {
    return { kind: "commit", sha: selection.sha };
  }
  return selection.side === "unstaged"
    ? { kind: "working-tree" }
    : { kind: "index" };
}

/// Old/new blob sources for the image viewer (issue #60). Commit
/// selections diff the first parent against the commit; staging
/// selections diff index↔working-tree (unstaged) or HEAD↔index (staged).
function selectionImageSources(
  repo: string,
  selection: NonNullable<ReturnType<typeof selectedDiffFile>>,
): ImageSources {
  const path = selection.path;
  if (selection.kind === "commit") {
    return {
      repoPath: repo,
      path,
      old: { kind: "commit-parent", sha: selection.sha },
      new: { kind: "commit", sha: selection.sha },
    };
  }
  return selection.side === "unstaged"
    ? { repoPath: repo, path, old: { kind: "index" }, new: { kind: "working-tree" } }
    : { repoPath: repo, path, old: { kind: "head" }, new: { kind: "index" } };
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

  /// Full-file content for INLINE / CONTENT modes. Refetched on
  /// selection change + on each working-tree refresh so edits made
  /// outside yryvu are reflected. Skipped entirely for HUNK / SPLIT
  /// (those work off the hunk-only diff data).
  const [fullContent] = createResource<FileContent | null, DiffSource>(
    (): DiffSource | undefined => {
      const p = repoPath();
      const sel = selectedDiffFile();
      const mode = fileViewMode();
      if (!p || !sel) return undefined;
      if (mode !== "inline" && mode !== "content") return undefined;
      return [p, sel, workingTreeNonce()];
    },
    async ([p, sel]) =>
      await readFileContent(p, sel.path, selectionContentSource(sel)),
  );

  /// Blame data for BLAME mode. Tied to the selection — for a commit
  /// selection, blame is computed at that commit; for staging
  /// selections, at HEAD (working-tree edits aren't part of any commit
  /// history yet so blame falls back to the last committed state).
  const [blame] = createResource<FileBlame | null, DiffSource>(
    (): DiffSource | undefined => {
      const p = repoPath();
      const sel = selectedDiffFile();
      if (!p || !sel) return undefined;
      if (fileViewMode() !== "blame") return undefined;
      return [p, sel, workingTreeNonce()];
    },
    async ([p, sel]) => {
      const sha = sel.kind === "commit" ? sel.sha : undefined;
      return await getFileBlame(p, sel.path, sha);
    },
  );

  let bodyRef: HTMLDivElement | undefined;
  const [activeHunk, setActiveHunk] = createSignal(0);

  function scrollToHunk(idx: number) {
    const root = bodyRef;
    if (!root) return;
    const hunks = root.querySelectorAll<HTMLDivElement>(".diff-hunk");
    const target = hunks[idx];
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("diff-hunk--flash");
    window.setTimeout(() => target.classList.remove("diff-hunk--flash"), 600);
  }

  /// Wire/refresh the prev/next callbacks on the global signal channel
  /// each time the loaded file changes — mirrors GK's
  /// `GoToNextAndPreviousDiffChangeCbsUpdated` dispatch.
  createEffect(() => {
    const f = file();
    const mode = fileViewMode();
    if (!f || f.hunks.length === 0 || mode === "content") {
      clearDiffNavigator();
      return;
    }
    const count = f.hunks.length;
    setDiffNavigator({
      next: () => {
        const idx = Math.min(activeHunk() + 1, count - 1);
        setActiveHunk(idx);
        scrollToHunk(idx);
      },
      prev: () => {
        const idx = Math.max(activeHunk() - 1, 0);
        setActiveHunk(idx);
        scrollToHunk(idx);
      },
    });
  });

  onCleanup(() => clearDiffNavigator());

  // Hunk index queued for destructive discard. `null` = dialog closed.
  const [pendingDiscardHunk, setPendingDiscardHunk] = createSignal<
    number | null
  >(null);

  const selection = () => selectedDiffFile();
  const targetPath = () => selection()?.path;

  /// Stable image sources for the focused file. Recomputed only when the
  /// repo or selection changes, so the viewer's blob fetches aren't
  /// re-triggered on unrelated re-renders.
  const imageSources = createMemo<ImageSources | undefined>(() => {
    const p = repoPath();
    const sel = selection();
    if (!p || !sel) return undefined;
    return selectionImageSources(p, sel);
  });

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

  async function handleLineOp(
    op: (
      p: string,
      path: string,
      ranges: { hunkIndex: number; lineIndices: number[] }[],
    ) => Promise<void>,
    failTitle: string,
    hunkIndex: number,
    lineIndex: number,
  ) {
    const p = repoPath();
    const sel = selection();
    if (!p || !sel || sel.kind !== "staging") return;
    try {
      await op(p, sel.path, [{ hunkIndex, lineIndices: [lineIndex] }]);
    } catch (err) {
      notify.error(failTitle, {
        message: String(err),
        category: "commit",
      });
    }
    refreshWorkingTree();
  }

  function lineStagingApi(): LineStagingApi | undefined {
    const sel = selection();
    if (!sel || sel.kind !== "staging") return undefined;
    return {
      side: sel.side,
      onApplyLine: (hunkIndex, lineIndex) => {
        const verb = sel.side === "unstaged" ? stageLines : unstageLines;
        const title =
          sel.side === "unstaged" ? "Stage line failed" : "Unstage line failed";
        void handleLineOp(verb, title, hunkIndex, lineIndex);
      },
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

      <DiffToolbar />

      <div class="file-diff-tab__body" ref={bodyRef}>
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
              viewMode={fileViewMode()}
              fullContent={fullContent()?.content}
              blameLines={blame()?.lines}
              onJumpToBlameCommit={(sha) => {
                // Selecting the commit also closes the diff tab so the
                // graph + inspector show that commit's full context.
                setSelectedCommit(sha);
                closeDiffTab();
              }}
              stagingActions={stagingActions()}
              lineStagingApi={lineStagingApi()}
              imageSources={imageSources()}
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
