// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, For, on, Show } from "solid-js";

import type { FileDiff } from "../../ipc/diff";
import { FileListToolbar } from "./FileListToolbar";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { Row } from "./Row";
import {
  collapseAllDirs,
  displayTree,
  expandAllDirs,
  filterQuery,
  forceFileVisible,
  hasAnyCollapsed,
  isDirCollapsed,
  isFileForcedVisible,
  resetRevState,
  toggleDirCollapsed,
} from "./store";
import {
  ancestorPathsForMatches,
  buildTreeFromPaths,
  collectDirPaths,
  fileMatchesFilter,
  flattenFlat,
  flattenTree,
  type FlatRow,
} from "./treeBuild";

/// `listType` mirrors GitKraken's `listTypes` enum.
export type FileListType = "committed" | "staged" | "unstaged";

/// Per-file action surfaced on row hover (Stage / Discard / Unstage). Only
/// applied to file rows — directory rows ignore the slot.
export interface RowAction {
  label: string;
  title?: string;
  /// `danger` tints the button red on hover (Discard).
  variant?: "default" | "danger";
  onClick: (path: string) => void;
}

export interface FileListProps {
  repoId: string;
  /// Cache key: commit SHA for `committed`, the listType name itself for
  /// working-tree variants. Changing this resets per-revision ephemeral
  /// state (collapsed dirs, forced-visible files).
  revKey: string;
  listType: FileListType;
  files: FileDiff[];
  activeFilePath: string | undefined;
  onSelectFile: (path: string) => void;
  /// Optional per-file action buttons (Stage / Discard / Unstage). Working-
  /// tree variants pass non-empty; the committed variant leaves them off.
  rowActions?: RowAction[];
  /// CommitPanel renders ONE shared toolbar above its two sections — both
  /// FileList instances opt out via this flag to avoid duplicate Tree/Flat
  /// + filter inputs. The committed variant renders its own toolbar.
  hideToolbar?: boolean;
  /// When true and `files` is empty, render a skeleton row band instead
  /// of collapsing to nothing. Keeps the inspector populated while the
  /// diff IPC resolves (issue #176 — eggscape regression: 15K dirty
  /// files used to leave the panel blank for several seconds).
  loading?: boolean;
}

/// 1:1 port of GitKraken's RightPanel file-list widget.
///
/// Perf-critical pieces, mirrored from the bundle:
///   - **Object-map insert** for the dir tree (`_insertPathIntoTree` uses
///     `Map<name, node>` per level — O(depth) per file vs O(depth·siblings)
///     with naive array `.find()`).
///   - **Pre-flattened render list** via `flattenTree` / `flattenFlat`
///     (GK's `getFlattenedViewFromFileTree`) — a single flat `<For>`
///     instead of recursive components.
///   - **Memoized tree** rebuilt only when `props.files` reference changes.
///
/// Virtualization (react-virtualized `Grid` with `overscanRowCount:10` in
/// GK) is **not** wired here — the inspector body owns the vertical scroll
/// for the whole column, so the file list can't bound its own viewport
/// without restructuring the surrounding layout. Follow-up issue.
export function FileList(props: FileListProps) {
  const isTree = () => displayTree(props.repoId);
  const filter = () => filterQuery(props.repoId);

  // Drop collapsed-dir / forced-visible state whenever the rev or display
  // mode changes — `TreeViewAtShaReset` semantics. Keyed by
  // `(repoId, revKey, isTree)` so opposite-mode state never leaks in.
  createEffect(
    on(
      () => [props.revKey, isTree()] as const,
      ([rev, tree]) => resetRevState(props.repoId, rev, tree),
      { defer: true },
    ),
  );

  // Keep the current selection visible past the filter — equivalent of
  // `TreeViewFileForcedVisible`.
  createEffect(() => {
    const path = props.activeFilePath;
    if (!path) return;
    forceFileVisible(props.repoId, props.revKey, isTree(), path);
  });

  const isFileVisible = (path: string): boolean => {
    if (fileMatchesFilter(path, filter())) return true;
    return isFileForcedVisible(props.repoId, props.revKey, isTree(), path);
  };

  // Dirs that contain at least one filter-matching descendant — expanded
  // regardless of the per-dir collapsed state.
  const autoExpandedDirs = createMemo(() =>
    ancestorPathsForMatches(props.files, filter()),
  );

  const isDirExpanded = (dirPath: string): boolean => {
    if (autoExpandedDirs().has(dirPath)) return true;
    return !isDirCollapsed(props.repoId, props.revKey, isTree(), dirPath);
  };

  // Tree is memoized on `props.files` — rebuilt once per diff response.
  const tree = createMemo(() => buildTreeFromPaths(props.files));
  const allDirPaths = createMemo(() => collectDirPaths(tree()));

  // Flattened visible rows — 1:1 with GK's `makeGetFlattenedViewFromTreeView`.
  const rows = createMemo<FlatRow[]>(() => {
    if (isTree()) return flattenTree(tree(), isDirExpanded, isFileVisible);
    return flattenFlat(props.files, isFileVisible);
  });

  const onClick = (row: FlatRow) => {
    if (row.kind === "file") {
      props.onSelectFile(row.path);
    } else {
      toggleDirCollapsed(props.repoId, props.revKey, isTree(), row.path);
    }
  };

  return (
    <div class="file-list">
      <Show when={!props.hideToolbar}>
        <FileListToolbar
          repoId={props.repoId}
          allExpanded={
            !hasAnyCollapsed(props.repoId, props.revKey, isTree())
          }
          onExpandAll={() => expandAllDirs(props.repoId, props.revKey, isTree())}
          onCollapseAll={() =>
            collapseAllDirs(props.repoId, props.revKey, isTree(), allDirPaths())
          }
        />
      </Show>
      <Show
        when={!(props.loading && props.files.length === 0)}
        fallback={<LoadingSkeleton />}
      >
        <ul class="file-list__items">
          <For each={rows()}>
            {(row) => (
              <li>
                <Row
                  row={row}
                  active={
                    row.kind === "file" && props.activeFilePath === row.path
                  }
                  isExpanded={
                    row.kind === "dir" ? isDirExpanded(row.path) : false
                  }
                  onClick={() => onClick(row)}
                  actions={props.rowActions}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
