// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, For, Show } from "solid-js";

import { getCommitDiff, type CommitDiff, type FileDiff, type FileStatus } from "../../ipc";
import {
  openDiffTab,
  repoPath,
  selectedCommit,
  selectedDiffFile,
} from "../../state";

function statusTone(status: FileStatus): { label: string; tone: string } {
  switch (status) {
    case "added":
      return { label: "A", tone: "added" };
    case "modified":
      return { label: "M", tone: "modified" };
    case "deleted":
      return { label: "D", tone: "deleted" };
    case "renamed":
      return { label: "R", tone: "renamed" };
    case "copied":
      return { label: "C", tone: "renamed" };
    case "type-change":
      return { label: "T", tone: "modified" };
    default:
      return { label: "·", tone: "modified" };
  }
}

export function RightPanel() {
  const dirtyFileCount = () => 0;

  const [diff] = createResource<CommitDiff | undefined, [string, string]>(
    () => {
      const p = repoPath();
      const s = selectedCommit();
      return p && s ? ([p, s] as [string, string]) : undefined;
    },
    async ([p, s]) => await getCommitDiff(p, s),
  );

  const totals = () => {
    const d = diff();
    if (!d) return { add: 0, del: 0, files: 0 };
    return d.files.reduce(
      (acc, f) => ({
        add: acc.add + f.additions,
        del: acc.del + f.deletions,
        files: acc.files + 1,
      }),
      { add: 0, del: 0, files: 0 },
    );
  };

  return (
    <aside class="inspector">
      <Show when={dirtyFileCount() > 0}>
        <div class="inspector__banner">
          <span>
            {dirtyFileCount()} file change{dirtyFileCount() === 1 ? "" : "s"} in working directory
          </span>
          <button class="inspector__banner-action" type="button" disabled>
            View Changes
          </button>
        </div>
      </Show>

      <div class="inspector__body">
        <Show
          when={selectedCommit()}
          fallback={<p class="inspector__empty">Select a commit to see its details.</p>}
        >
          {(sha) => (
            <>
              <div class="inspector__header">
                <span class="inspector__header-label">commit</span>
                <code class="inspector__header-sha">{sha().slice(0, 10)}</code>
              </div>

              <Show when={diff.loading}>
                <div class="inspector__status">Loading commit details…</div>
              </Show>
              <Show when={diff.error}>
                <div class="inspector__error">{String(diff.error)}</div>
              </Show>

              <Show when={diff() && !diff.loading && !diff.error}>
                <div class="inspector__summary">
                  <span>
                    {totals().files} file{totals().files === 1 ? "" : "s"} changed
                  </span>
                  <Show when={totals().add > 0 || totals().del > 0}>
                    <span class="inspector__summary-stats">
                      <Show when={totals().add > 0}>
                        <span class="inspector__summary-stats--add">+{totals().add}</span>
                      </Show>
                      <Show when={totals().del > 0}>
                        <span class="inspector__summary-stats--del">-{totals().del}</span>
                      </Show>
                    </span>
                  </Show>
                  <Show when={diff()!.parent_sha}>
                    <span class="inspector__summary-parent">
                      vs <code>{diff()!.parent_sha!.slice(0, 7)}</code>
                    </span>
                  </Show>
                </div>

                <ul class="changed-files">
                  <For each={diff()!.files}>
                    {(f: FileDiff) => {
                      const s = statusTone(f.status);
                      const isActive = () =>
                        selectedDiffFile()?.sha === diff()!.sha &&
                        selectedDiffFile()?.path === f.path;
                      return (
                        <li>
                          <button
                            class="changed-files__row"
                            type="button"
                            data-active={isActive() ? "true" : "false"}
                            title={f.path}
                            onClick={() => openDiffTab(diff()!.sha, f.path)}
                          >
                            <span class="changed-files__status" data-tone={s.tone}>
                              {s.label}
                            </span>
                            <Show when={f.old_path}>
                              <span class="changed-files__old">{f.old_path} →</span>
                            </Show>
                            <span class="changed-files__path">{f.path}</span>
                            <Show when={f.additions > 0 || f.deletions > 0}>
                              <span class="changed-files__stats">
                                <Show when={f.additions > 0}>
                                  <span class="changed-files__stats--add">+{f.additions}</span>
                                </Show>
                                <Show when={f.deletions > 0}>
                                  <span class="changed-files__stats--del">-{f.deletions}</span>
                                </Show>
                              </span>
                            </Show>
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
            </>
          )}
        </Show>
      </div>
    </aside>
  );
}
