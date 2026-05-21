// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";

export interface HunkStagingActions {
  /// Which side of the staging view this diff represents — drives which
  /// per-hunk buttons render (`Stage Hunk` + `Discard Hunk` on unstaged,
  /// `Unstage Hunk` on staged). Mirrors GitKraken `listType`.
  side: "unstaged" | "staged";
  onStageHunk: (hunkIndex: number) => void;
  onUnstageHunk: (hunkIndex: number) => void;
  /// Caller is responsible for surfacing a destructive-confirmation
  /// dialog before invoking the backend. The signature accepts the hunk
  /// index so the dialog can show the correct hunk header.
  onDiscardHunk: (hunkIndex: number) => void;
}

export function HunkActions(props: {
  index: number;
  actions: HunkStagingActions;
}): JSX.Element {
  return (
    <span class="diff-hunk__actions">
      <Show when={props.actions.side === "unstaged"}>
        <button
          class="diff-hunk__action"
          type="button"
          onClick={() => props.actions.onStageHunk(props.index)}
        >
          Stage Hunk
        </button>
        <button
          class="diff-hunk__action diff-hunk__action--danger"
          type="button"
          onClick={() => props.actions.onDiscardHunk(props.index)}
        >
          Discard Hunk
        </button>
      </Show>
      <Show when={props.actions.side === "staged"}>
        <button
          class="diff-hunk__action"
          type="button"
          onClick={() => props.actions.onUnstageHunk(props.index)}
        >
          Unstage Hunk
        </button>
      </Show>
    </span>
  );
}
