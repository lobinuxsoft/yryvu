// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, type Accessor } from "solid-js";

import type { GraphRow } from "../../ipc";
import {
  amendEnabled,
  dirtyFileCount,
  inspectorMode,
  selectedShas,
  selectRangeTo,
  setInspectorMode,
  setSelectedCommit,
  toggleCommitInSelection,
  toggleWorkdirInSelection,
} from "../../state";

interface SelectionOptions {
  rows: Accessor<GraphRow[]>;
}

/**
 * Click-handling + selection-membership surface for the commit graph.
 *
 * `selectedShasSet` memoizes the active selection as a Set so each
 * row's `is-selected` lookup stays O(1) without reallocating the set
 * on every render.
 */
export function useGraphSelection(opts: SelectionOptions) {
  /**
   * Selection set used for `is-selected` / `data-selected` lookups across
   * every zone. Memoized so the per-row `Set.has` cost stays O(1) and the
   * render path doesn't reallocate the set on every row mount.
   */
  const selectedShasSet = createMemo(() => new Set(selectedShas()));

  function openStaging() {
    // Guard: no point entering the commit panel with a clean tree unless
    // the user is composing an amend (reword of HEAD). Clicking the WIP
    // row on a clean repo used to drop users into an empty panel with
    // all-zero counts, which read as "there are uncommitted changes"
    // just because the UI was visible.
    if (dirtyFileCount() === 0 && !amendEnabled()) return;
    setSelectedCommit(undefined);
    setInspectorMode("staging");
  }

  /**
   * Click handler for committed rows. 1:1 with GitKraken's
   * `onSelectCommit` saga:
   *
   *   - Plain click → single-select, anchor moves to this sha.
   *   - Ctrl/Cmd+click → toggle this sha in/out of the selection;
   *     anchor untouched.
   *   - Shift+click → range-extend from anchor to this sha using the
   *     graph's row order; anchor untouched.
   *
   * Always returns to inspector "details" so the right panel switches
   * away from the staging composer when the user selects a commit.
   */
  function handleCommitClick(e: MouseEvent, sha: string): void {
    if (e.shiftKey) {
      const ordered = opts.rows().map((r) => r.sha);
      selectRangeTo(sha, ordered);
    } else if (e.ctrlKey || e.metaKey) {
      toggleCommitInSelection(sha);
    } else {
      setSelectedCommit(sha);
    }
    if (inspectorMode() !== "details") setInspectorMode("details");
  }

  /**
   * Click handler for the WIP pseudo-row. Plain click keeps the legacy
   * "open staging composer" behaviour (matches GitKraken's WIP row primary
   * action). Ctrl/Cmd+click toggles the workdir bit alongside any existing
   * commit selection so the inspector renders the commit-vs-WIP /
   * multi-vs-WIP merged diff variants.
   */
  function handleWipClick(e: MouseEvent): void {
    if (e.ctrlKey || e.metaKey) {
      toggleWorkdirInSelection();
      if (inspectorMode() !== "details") setInspectorMode("details");
      return;
    }
    openStaging();
  }

  return {
    selectedShasSet,
    handleCommitClick,
    handleWipClick,
    openStaging,
  };
}

export type GraphSelection = ReturnType<typeof useGraphSelection>;
