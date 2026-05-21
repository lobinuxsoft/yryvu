// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";

import type { DiffLine } from "../../ipc";
import { LineActions, type LineStagingApi } from "./LineActions";

interface SplitCell {
  line: DiffLine;
  /// Position of this line in the parent hunk's flat `lines` array.
  /// Preserved through the split pairing so per-line actions can route
  /// back to the right unidiff index.
  index: number;
}

export interface SplitPair {
  left: SplitCell | null;
  right: SplitCell | null;
}

/**
 * Walk unified-diff lines and pair them into split-view rows. Context
 * lines go to both columns. A block of N removed followed by M added is
 * zipped: rows 1..min(N,M) pair them; rows beyond one side get `null`
 * on the other. Matches GitKraken's side-by-side behaviour.
 */
export function pairLines(lines: DiffLine[]): SplitPair[] {
  const rows: SplitPair[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "context") {
      const cell: SplitCell = { line, index: i };
      rows.push({ left: cell, right: cell });
      i++;
      continue;
    }
    const removed: SplitCell[] = [];
    const added: SplitCell[] = [];
    while (i < lines.length && lines[i].kind === "removed") {
      removed.push({ line: lines[i], index: i });
      i++;
    }
    while (i < lines.length && lines[i].kind === "added") {
      added.push({ line: lines[i], index: i });
      i++;
    }
    const pairs = Math.max(removed.length, added.length);
    for (let j = 0; j < pairs; j++) {
      rows.push({
        left: removed[j] ?? null,
        right: added[j] ?? null,
      });
    }
  }
  return rows;
}

export function SplitLineRow(props: {
  pair: SplitPair;
  hunkIndex: number;
  highlight: (content: string) => string;
  lineStagingApi?: LineStagingApi;
}): JSX.Element {
  const leftHtml = () =>
    props.pair.left ? props.highlight(props.pair.left.line.content) : "";
  const rightHtml = () =>
    props.pair.right ? props.highlight(props.pair.right.line.content) : "";
  const leftKind = () => props.pair.left?.line.kind ?? "empty";
  const rightKind = () => props.pair.right?.line.kind ?? "empty";

  return (
    <div class="diff-split-row">
      <div class="diff-split-cell" data-kind={leftKind()}>
        <span class="diff-line__gutter">
          <Show when={props.lineStagingApi && props.pair.left}>
            <LineActions
              line={props.pair.left!.line}
              hunkIndex={props.hunkIndex}
              lineIndex={props.pair.left!.index}
              api={props.lineStagingApi!}
            />
          </Show>
        </span>
        <span class="diff-line__no">
          {props.pair.left?.line.old_line_no ?? ""}
        </span>
        <span class="diff-line__content" innerHTML={leftHtml()} />
      </div>
      <div class="diff-split-cell" data-kind={rightKind()}>
        <span class="diff-line__gutter">
          <Show when={props.lineStagingApi && props.pair.right}>
            <LineActions
              line={props.pair.right!.line}
              hunkIndex={props.hunkIndex}
              lineIndex={props.pair.right!.index}
              api={props.lineStagingApi!}
            />
          </Show>
        </span>
        <span class="diff-line__no">
          {props.pair.right?.line.new_line_no ?? ""}
        </span>
        <span class="diff-line__content" innerHTML={rightHtml()} />
      </div>
    </div>
  );
}
