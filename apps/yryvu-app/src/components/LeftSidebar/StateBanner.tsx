// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { RepoStateInfo } from "../../ipc";
import { openConflictDialog } from "../ConflictResolverDialog/state";
import { repoPath } from "../../state";
import { stateBannerTitle } from "./helpers";

export interface StateBannerProps {
  state: RepoStateInfo;
  onAbortMerge: () => void;
}

export function StateBanner(props: StateBannerProps) {
  return (
    <div class="sidebar__state-banner" data-kind={props.state.kind}>
      <div class="sidebar__state-banner__title">
        <span>⚠</span>
        <span>{stateBannerTitle(props.state.kind)}</span>
      </div>
      <Show when={props.state.conflict_paths.length > 0}>
        <div class="sidebar__state-banner__subtitle">
          Conflicted files ({props.state.conflict_paths.length}):
        </div>
        <ul class="sidebar__state-banner__paths">
          <For each={props.state.conflict_paths}>{(p) => <li>{p}</li>}</For>
        </ul>
      </Show>
      <div class="sidebar__state-banner__actions">
        <Show when={props.state.conflict_paths.length > 0}>
          <button
            class="dialog__btn"
            type="button"
            onClick={() => {
              const path = repoPath();
              if (path) openConflictDialog({ repoPath: path });
            }}
          >
            Resolve conflicts
          </button>
        </Show>
        <Show when={props.state.kind === "merge"}>
          <button
            class="dialog__btn dialog__btn--danger"
            type="button"
            onClick={() => props.onAbortMerge()}
          >
            Abort merge
          </button>
        </Show>
        <Show when={props.state.kind !== "merge" && props.state.conflict_paths.length === 0}>
          <span class="sidebar__state-banner__hint">
            Abort support for this state is not implemented yet — resolve
            manually or via CLI.
          </span>
        </Show>
      </div>
    </div>
  );
}
