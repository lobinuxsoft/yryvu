// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, Show } from "solid-js";

import {
  getCommitDiff,
  getStagedDiff,
  getUnstagedDiff,
  type FileDiff,
} from "../../ipc";
import {
  closeDiffTab,
  repoPath,
  selectedDiffFile,
  workingTreeNonce,
} from "../../state";
import { DiffFileBlock } from "../DiffView";
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

  const selection = () => selectedDiffFile();
  const targetPath = () => selection()?.path;

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
            />
          </Show>
        </Show>
      </div>
    </div>
  );
}
