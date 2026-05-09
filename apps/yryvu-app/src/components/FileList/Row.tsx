// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import { statusTone } from "../RightPanel/statusTone";
import type { RowAction } from "./index";
import type { FlatRow } from "./treeBuild";

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
      <button
        type="button"
        class="file-list__row"
        data-active={props.active ? "true" : "false"}
        title={props.row.path}
        style={{ "padding-left": `${indent()}px`, height: `${ROW_HEIGHT}px` }}
        onClick={() => props.onClick()}
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
      <Show when={props.actions && props.actions.length > 0}>
        <div class="file-list__row-actions">
          <For each={props.actions}>
            {(a) => (
              <button
                type="button"
                class="file-list__row-action"
                data-variant={a.variant ?? "default"}
                title={a.title ?? a.label}
                onClick={(e) => {
                  e.stopPropagation();
                  a.onClick(props.row.path);
                }}
              >
                {a.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

function DirLine(props: RowProps) {
  const name = () => (props.row as Extract<FlatRow, { kind: "dir" }>).name;
  const indent = () =>
    props.row.depth * TREE_VIEW_LEVEL_INDENT +
    FILE_NODE_CONTENTS_DIRECTORY_PADDING_LEFT;

  return (
    <button
      type="button"
      class="file-list__dir"
      aria-expanded={props.isExpanded}
      title={props.row.path}
      style={{ "padding-left": `${indent()}px`, height: `${ROW_HEIGHT}px` }}
      onClick={() => props.onClick()}
    >
      <span
        class="file-list__dir-chevron"
        data-collapsed={props.isExpanded ? "false" : "true"}
      >
        ▸
      </span>
      <span class="file-list__dir-name">{name()}</span>
    </button>
  );
}
