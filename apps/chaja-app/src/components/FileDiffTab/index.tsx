// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, Show } from "solid-js";

import { getCommitDiff, type CommitDiff, type FileDiff } from "../../ipc";
import { closeDiffTab, repoPath, selectedDiffFile } from "../../state";
import { DiffFileBlock } from "../DiffView";

export function FileDiffTab() {
  const [diff] = createResource<CommitDiff | undefined, [string, string]>(
    () => {
      const p = repoPath();
      const sdf = selectedDiffFile();
      return p && sdf ? ([p, sdf.sha] as [string, string]) : undefined;
    },
    async ([p, sha]) => await getCommitDiff(p, sha),
  );

  const targetPath = () => selectedDiffFile()?.path;

  const file = (): FileDiff | undefined => {
    const c = diff();
    const path = targetPath();
    if (!c || !path) return undefined;
    return c.files.find((f) => f.path === path);
  };

  return (
    <div class="file-diff-tab">
      <header class="file-diff-tab__header">
        <span class="file-diff-tab__path">{targetPath()}</span>
        <Show when={diff()?.sha}>
          <span class="file-diff-tab__commit">
            in <code>{diff()!.sha.slice(0, 7)}</code>
          </span>
        </Show>
        <button
          class="file-diff-tab__close"
          type="button"
          aria-label="Close diff"
          title="Close diff (return to graph)"
          onClick={() => closeDiffTab()}
        >
          ×
        </button>
      </header>

      <div class="file-diff-tab__body">
        <Show when={diff.loading}>
          <div class="file-diff-tab__status">Loading diff…</div>
        </Show>
        <Show when={diff.error}>
          <div class="file-diff-tab__error">{String(diff.error)}</div>
        </Show>
        <Show when={diff() && !diff.loading && !diff.error}>
          <Show
            when={file()}
            fallback={
              <div class="file-diff-tab__status">
                File <code>{targetPath()}</code> not found in the commit's diff.
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
