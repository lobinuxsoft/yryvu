// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import { statusTone, type StatusTone } from "../RightPanel/statusTone";
import { Tooltip } from "../Tooltip";
import type { RowAction } from "./index";
import { SUMMARY_ORDER, summaryIsEmpty, type FlatRow } from "./treeBuild";

/// Row-level constants grepped from GitKraken's bundle (see research doc
/// `gitkraken-diff/05-file-list-widget.md`). Uniform row height (32 px for
/// both files and dirs) simplifies virtualization — GK uses 25 for dirs
/// and 32 for files via `Grid` + polymorphic `rowHeight`, but a uniform
/// height avoids a cell-measurer here and the visual delta is negligible.
export const ROW_HEIGHT = 32;
export const TREE_VIEW_LEVEL_INDENT = 15;
export const FILE_NODE_CONTENTS_PADDING_LEFT = 10;
export const FILE_NODE_CONTENTS_DIRECTORY_PADDING_LEFT = 3;

export interface RowProps {
  row: FlatRow;
  active: boolean;
  isExpanded: boolean;
  onClick: () => void;
  /// File-row only; ignored for directories.
  actions?: RowAction[];
  /// File-row context menu trigger (issue #7 — "Show history"). Receives
  /// the native event so the caller can compute the popup anchor +
  /// preventDefault. Optional: when omitted, native browser menu wins.
  onContextMenu?: (e: MouseEvent, path: string) => void;
}

export function Row(props: RowProps) {
  return (
    <Show when={props.row.kind === "file"} fallback={<DirLine {...props} />}>
      <FileLine {...props} />
    </Show>
  );
}

function FileLine(props: RowProps) {
  const file = () => (props.row as Extract<FlatRow, { kind: "file" }>).data;
  const label = () => (props.row as Extract<FlatRow, { kind: "file" }>).label;
  const tone = () => statusTone(file().status);
  const indent = () =>
    props.row.depth * TREE_VIEW_LEVEL_INDENT + FILE_NODE_CONTENTS_PADDING_LEFT;

  return (
    <>
      <Tooltip text={props.row.path}>
      <button
        type="button"
        class="file-list__row"
        data-active={props.active ? "true" : "false"}
        style={{ "padding-left": `${indent()}px`, height: `${ROW_HEIGHT}px` }}
        onClick={() => props.onClick()}
        onContextMenu={(e) => props.onContextMenu?.(e, props.row.path)}
      >
        <span class="changed-files__status" data-tone={tone().tone}>
          {tone().label}
        </span>
        <Show when={file().old_path}>
          <span class="changed-files__old">{file().old_path} →</span>
        </Show>
        <span class="changed-files__path">{label()}</span>
        <Show when={file().additions > 0 || file().deletions > 0}>
          <span class="changed-files__stats">
            <Show when={file().additions > 0}>
              <span class="changed-files__stats--add">+{file().additions}</span>
            </Show>
            <Show when={file().deletions > 0}>
              <span class="changed-files__stats--del">-{file().deletions}</span>
            </Show>
          </span>
        </Show>
      </button>
      </Tooltip>
      <Show when={props.actions && props.actions.length > 0}>
        <div class="file-list__row-actions">
          <For each={props.actions}>
            {(a) => (
              <Tooltip text={a.title ?? a.label}>
                <button
                  type="button"
                  class="file-list__row-action"
                  data-variant={a.variant ?? "default"}
                  onClick={(e) => {
                    e.stopPropagation();
                    a.onClick(props.row.path);
                  }}
                >
                  {a.label}
                </button>
              </Tooltip>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

function DirLine(props: RowProps) {
  const dir = () => props.row as Extract<FlatRow, { kind: "dir" }>;
  const indent = () =>
    props.row.depth * TREE_VIEW_LEVEL_INDENT +
    FILE_NODE_CONTENTS_DIRECTORY_PADDING_LEFT;

  /// GK gates the summary on `isDirectory && isCollapsed` (bundle
  /// 5509090) — expanded folders hide their own badges because the
  /// rows underneath now say the same thing. Nested collapsed folders
  /// keep theirs, and that cascade needs no coordination: every row
  /// just answers for its own subtree.
  const badges = () =>
    props.isExpanded || summaryIsEmpty(dir().summary)
      ? []
      : SUMMARY_ORDER.filter((tone) => dir().summary[tone] > 0);

  /// Screen readers get the counts spelled out; the chips themselves
  /// are two glyphs of shorthand.
  const summaryLabel = () =>
    badges()
      .map((tone) => `${dir().summary[tone]} ${tone}`)
      .join(", ");

  return (
    <Tooltip text={props.row.path}>
    <button
      type="button"
      class="file-list__dir"
      aria-expanded={props.isExpanded}
      style={{ "padding-left": `${indent()}px`, height: `${ROW_HEIGHT}px` }}
      onClick={() => props.onClick()}
    >
      <span
        class="file-list__dir-chevron"
        data-collapsed={props.isExpanded ? "false" : "true"}
      >
        ▸
      </span>
      <span class="file-list__dir-name">{dir().name}</span>
      <Show when={badges().length > 0}>
        <span class="file-list__dir-badges" aria-label={summaryLabel()}>
          <For each={badges()}>
            {(tone) => (
              // Same chip as the per-file status letter so a folder's
              // badge and the rows inside it never disagree on colour.
              // GK uses per-type icons here; yryvu's file rows already
              // speak in letters, so the badges do too.
              <span class="file-list__dir-badge" data-tone={tone}>
                {TONE_LETTER[tone]}
                {dir().summary[tone]}
              </span>
            )}
          </For>
        </span>
      </Show>
    </button>
    </Tooltip>
  );
}

const TONE_LETTER: Record<StatusTone, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
};
