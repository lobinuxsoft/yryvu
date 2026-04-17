// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { selectedCommit } from "../../state";

export function RightPanel() {
  // Dirty working dir detection is not yet wired — placeholder until a
  // commands/working_dir call exists on the Rust side (post #29).
  const dirtyFileCount = () => 0;

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
              <p class="inspector__empty">
                Commit <code>{sha().slice(0, 7)}</code> — detail rendering arrives with #6 (diff viewer) and
                follow-ups to this shell scaffold.
              </p>
            </>
          )}
        </Show>
      </div>
    </aside>
  );
}
