// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, Show } from "solid-js";

import { getCommitDiff, type CommitDiff } from "../../ipc";
import { repoPath, selectedCommit } from "../../state";
import { DiffView } from "../DiffView";

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
              <DiffView
                diff={diff()}
                loading={diff.loading}
                error={diff.error ? String(diff.error) : undefined}
              />
            </>
          )}
        </Show>
      </div>
    </aside>
  );
}
