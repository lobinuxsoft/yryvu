// SPDX-License-Identifier: AGPL-3.0-or-later

import { IconSortAsc, IconSortDesc } from "../Icons";
import { Tooltip } from "../Tooltip";
import {
  displayTree,
  filterQuery,
  setDisplayTree,
  setFilterQuery,
  setSortDescending,
  sortDescending,
} from "./store";

export interface FileListToolbarProps {
  repoId: string;
  /// Computed by the caller from per-rev state (`hasAnyCollapsed`). Drives
  /// the label and click action of the Expand/Collapse-all button so it
  /// reflects what's visible on screen rather than a persisted flag that
  /// can drift across sessions.
  allExpanded: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/// Toolbar row: tree/flat toggle + expand/collapse all + filter input.
/// 1:1 with GitKraken's RightPanel toolbar (see research doc
/// `gitkraken-right-panel/06-file-list-inspector-specifics.md`).
export function FileListToolbar(props: FileListToolbarProps) {
  const isTree = () => displayTree(props.repoId);
  const isDescending = () => sortDescending(props.repoId);
  const expandLabel = () => (props.allExpanded ? "Collapse All" : "Expand All");

  return (
    <div class="file-list__toolbar" role="toolbar">
      {/* GK's `div.sort-button`, flush left of the mode toggle: one key
          (the path), two directions, glyph shows which (bundle 10546400). */}
      <Tooltip text="Sort by filename">
        <button
          type="button"
          class="file-list__sort"
          aria-label="Sort by filename"
          aria-pressed={isDescending()}
          onClick={() => setSortDescending(props.repoId, !isDescending())}
        >
          {isDescending() ? (
            <IconSortDesc width={14} height={14} />
          ) : (
            <IconSortAsc width={14} height={14} />
          )}
        </button>
      </Tooltip>

      <div class="file-list__toolbar-modes" role="group" aria-label="Display mode">
        <Tooltip text="Flat list">
          <button
            type="button"
            class="file-list__mode"
            data-active={isTree() ? "false" : "true"}
            onClick={() => setDisplayTree(props.repoId, false)}
          >
            Path
          </button>
        </Tooltip>
        <Tooltip text="Tree">
          <button
            type="button"
            class="file-list__mode"
            data-active={isTree() ? "true" : "false"}
            onClick={() => setDisplayTree(props.repoId, true)}
          >
            Tree
          </button>
        </Tooltip>
      </div>

      <Tooltip text={expandLabel()}>
        <button
          type="button"
          class="file-list__expand-toggle"
          disabled={!isTree()}
          onClick={() =>
            props.allExpanded ? props.onCollapseAll() : props.onExpandAll()
          }
        >
          {expandLabel()}
        </button>
      </Tooltip>

      <input
        type="search"
        class="file-list__filter"
        placeholder="Filter files"
        aria-label="Filter files"
        value={filterQuery(props.repoId)}
        onInput={(e) => setFilterQuery(props.repoId, e.currentTarget.value)}
      />
    </div>
  );
}
