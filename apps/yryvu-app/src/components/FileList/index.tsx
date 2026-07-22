// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";

import type { FileDiffMeta } from "../../ipc/diff";
import {
  openDiffTab,
  openFileHistory,
  openStagingDiffTab,
  setFileViewMode,
} from "../../state";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { FileListToolbar } from "./FileListToolbar";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { Row, ROW_HEIGHT } from "./Row";
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
  sortDescending,
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
  files: FileDiffMeta[];
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

/// GK always virtualizes its file lists (react-virtualized `Grid`,
/// overscan 10 via the fork default); we window only past this row count
/// so small diffs keep plain, inspectable DOM (#430 part C — no
/// virtualization overhead for the common case).
const VIRTUALIZE_OVER = 100;
const OVERSCAN_ROWS = 10;

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
///   - **Windowed rendering** above `VIRTUALIZE_OVER` rows (#430):
///     `.file-list__items` owns a bounded scroll viewport (see the
///     layout notes in `styles/file-list.css`) and rows render
///     absolutely-positioned inside a sizer, house pattern of
///     `FileHistoryPanel`. The scroll element stays mounted across the
///     loading skeleton so the virtualizer never observes a dead ref.
export function FileList(props: FileListProps) {
  const isTree = () => displayTree(props.repoId);
  const isDescending = () => sortDescending(props.repoId);
  const filter = () => filterQuery(props.repoId);

  // Drop collapsed-dir / forced-visible state whenever the rev or display
  // mode changes — `TreeViewAtShaReset` semantics. Keyed by
  // `(repoId, revKey, isTree)` so opposite-mode state never leaks in.
  // The viewport scroll is part of that reset: this FileList instance
  // outlives commit selection (non-keyed Show), and the resource keeps
  // stale files during refetch so the skeleton never intervenes to
  // discard scrollTop — without this, a new rev renders windowed around
  // the previous rev's offset (mid-list, no visual cue).
  createEffect(
    on(
      () => [props.revKey, isTree()] as const,
      ([rev, tree]) => {
        resetRevState(props.repoId, rev, tree);
        if (itemsEl) itemsEl.scrollTop = 0;
        // Sync the virtualizer's cached offset in the same tick so the
        // virtual path doesn't render one frame around the stale offset.
        virtualizer.scrollToOffset(0);
      },
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

  // Tree is memoized on `props.files` — rebuilt once per diff response,
  // plus once per sort flip (the direction is baked into sibling order).
  const tree = createMemo(() => buildTreeFromPaths(props.files, isDescending()));
  const allDirPaths = createMemo(() => collectDirPaths(tree()));

  // Flattened visible rows — 1:1 with GK's `makeGetFlattenedViewFromTreeView`.
  const rows = createMemo<FlatRow[]>(() => {
    if (isTree()) return flattenTree(tree(), isDirExpanded, isFileVisible);
    return flattenFlat(props.files, isFileVisible, isDescending());
  });

  const onClick = (row: FlatRow) => {
    if (row.kind === "file") {
      props.onSelectFile(row.path);
    } else {
      toggleDirCollapsed(props.repoId, props.revKey, isTree(), row.path);
    }
  };

  let itemsEl: HTMLDivElement | undefined;
  const virtualized = () => rows().length > VIRTUALIZE_OVER;
  // House pattern (FileHistoryPanel): reactive `count` getter, fixed
  // row estimate, no measureElement. Count is 0 below the threshold so
  // the virtualizer idles while the plain `<For>` path renders.
  const virtualizer = createVirtualizer({
    get count() {
      return virtualized() ? rows().length : 0;
    },
    getScrollElement: () => itemsEl ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });

  /// Shared row shell for both render paths. `start` present = virtual
  /// path (absolute positioning inside the sizer). `index` feeds
  /// aria-setsize/posinset so screen readers announce the true position
  /// even though windowing keeps only ~viewport rows in the DOM.
  const Item = (p: { row: FlatRow; start?: number; index?: number }) => (
    <div
      class="file-list__item"
      role="listitem"
      aria-setsize={p.start !== undefined ? rows().length : undefined}
      aria-posinset={p.index !== undefined ? p.index + 1 : undefined}
      classList={{ "file-list__item--virtual": p.start !== undefined }}
      style={
        p.start !== undefined
          ? { transform: `translateY(${p.start}px)`, height: `${ROW_HEIGHT}px` }
          : undefined
      }
    >
      <Row
        row={p.row}
        active={p.row.kind === "file" && props.activeFilePath === p.row.path}
        isExpanded={p.row.kind === "dir" ? isDirExpanded(p.row.path) : false}
        onClick={() => onClick(p.row)}
        actions={props.rowActions}
        onContextMenu={openMenuForFile}
      />
    </div>
  );

  /// Right-click menu state — file-row only. Two entries: "Show
  /// history" opens the FileHistoryPanel (#7), "Show blame" opens the
  /// file's diff in blame mode (#8). Working-tree files route blame
  /// through the unstaged-diff selector; committed lists go through
  /// the commit-diff selector — staging/commit context is inferred
  /// from `props.listType`.
  const [menu, setMenu] = createSignal<
    { x: number; y: number; items: ContextMenuItem[] } | null
  >(null);

  function openMenuForFile(e: MouseEvent, path: string) {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      { label: "Show history", onSelect: () => openFileHistory(path) },
      {
        label: "Show blame",
        onSelect: () => {
          // Open the appropriate diff source so FileDiffTab has data
          // to hand to BlameView, then flip the view mode.
          if (props.listType === "committed") {
            // committed lists carry a SHA via `revKey` — this is the
            // commit being viewed in the inspector.
            openDiffTab(props.revKey, path);
          } else {
            openStagingDiffTab(
              props.listType === "staged" ? "staged" : "unstaged",
              path,
            );
          }
          setFileViewMode("blame");
        },
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

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
      <Show when={props.loading && props.files.length === 0}>
        <LoadingSkeleton />
      </Show>
      {/* Always mounted (hidden behind the skeleton via CSS) so the
          virtualizer's scroll-element ref survives loading swaps. */}
      <div
        class="file-list__items"
        role="list"
        classList={{
          "file-list__items--hidden": props.loading && props.files.length === 0,
        }}
        ref={itemsEl}
      >
        <Show
          when={virtualized()}
          fallback={<For each={rows()}>{(row) => <Item row={row} />}</For>}
        >
          <div
            class="file-list__sizer"
            role="none"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            <For each={virtualizer.getVirtualItems()}>
              {(item) => (
                <Item
                  row={rows()[item.index]!}
                  start={item.start}
                  index={item.index}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={menu()}>
        <ContextMenu
          x={menu()!.x}
          y={menu()!.y}
          items={menu()!.items}
          onClose={() => setMenu(null)}
        />
      </Show>
    </div>
  );
}
