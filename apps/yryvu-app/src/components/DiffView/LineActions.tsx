// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";

import type { DiffLine } from "../../ipc";
import { Tooltip } from "../Tooltip";

export interface LineStagingApi {
  /// Same semantics as `HunkStagingActions.side`. Drives glyph + color:
  /// unstaged → green `+` (stage), staged → red `−` (unstage). Mirrors
  /// GitKraken bundle: `lineActionText:"+"` / `"-"` with the matching
  /// tooltip strings `StageThisLine` / `UnstageThisLine`.
  side: "unstaged" | "staged";
  onApplyLine: (hunkIndex: number, lineIndex: number) => void;
}

/**
 * Inline glyph rendered at the trailing edge of a changed line. Single
 * `+` (green) on unstaged stages that line into the index; `−` (red) on
 * staged rolls it back to HEAD. Discard at line level lives in the
 * right-click context menu per GitKraken (deferred — context menus are
 * a separate UI surface in the backlog).
 */
export function LineActions(props: {
  line: DiffLine;
  hunkIndex: number;
  lineIndex: number;
  api: LineStagingApi;
}): JSX.Element {
  const visible = () =>
    props.line.kind === "added" || props.line.kind === "removed";
  const glyph = () => (props.api.side === "unstaged" ? "+" : "−");
  const tooltip = () =>
    props.api.side === "unstaged" ? "Stage this line" : "Unstage this line";

  return (
    <Show when={visible()}>
      <Tooltip text={tooltip()}>
        <button
          class="diff-line__action"
          data-side={props.api.side}
          type="button"
          aria-label={tooltip()}
          onClick={() => props.api.onApplyLine(props.hunkIndex, props.lineIndex)}
        >
          {glyph()}
        </button>
      </Tooltip>
    </Show>
  );
}
