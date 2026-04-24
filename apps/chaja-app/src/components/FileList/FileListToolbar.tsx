// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  displayTree,
  filterQuery,
  fullyExpanded,
  setDisplayTree,
  setFilterQuery,
} from "./store";

export interface FileListToolbarProps {
  repoId: string;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/// Toolbar row: tree/flat toggle + expand/collapse all + filter input.
/// 1:1 with GitKraken's RightPanel toolbar (see research doc
/// `gitkraken-right-panel/06-file-list-inspector-specifics.md`).
export function FileListToolbar(props: FileListToolbarProps) {
  const isTree = () => displayTree(props.repoId);
  const expandLabel = () => (fullyExpanded(props.repoId) ? "Collapse All" : "Expand All");

  return (
    <div class="file-list__toolbar" role="toolbar">
      <div class="file-list__toolbar-modes" role="group" aria-label="Display mode">
        <button
          type="button"
          class="file-list__mode"
          data-active={isTree() ? "false" : "true"}
          title="Flat list"
          onClick={() => setDisplayTree(props.repoId, false)}
        >
          Path
        </button>
        <button
          type="button"
          class="file-list__mode"
          data-active={isTree() ? "true" : "false"}
          title="Tree"
          onClick={() => setDisplayTree(props.repoId, true)}
        >
          Tree
        </button>
      </div>

      <button
        type="button"
        class="file-list__expand-toggle"
        title={expandLabel()}
        disabled={!isTree()}
        onClick={() =>
          fullyExpanded(props.repoId) ? props.onCollapseAll() : props.onExpandAll()
        }
      >
        {expandLabel()}
      </button>

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
