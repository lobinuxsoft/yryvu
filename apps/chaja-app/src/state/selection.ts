// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createSignal } from "solid-js";

/// Selection model — multi-row selection plus the WIP pseudo-row.
///
/// `selectedShasInternal` is **youngest-first** (matches the order the
/// frontend selects rows in: a plain click puts the new sha at index 0,
/// Ctrl+click prepends, Shift+range walks rows in row-index order). The
/// backend's `combined_commit_diff` consumes the same orientation so no
/// reordering happens at the IPC boundary.
///
/// `selectionAnchorInternal` is the row Shift+click extends from. Plain
/// click resets it to the clicked sha; Ctrl+click leaves it untouched
/// (matches GitKraken / Finder convention).
const [selectedShasInternal, setSelectedShasInternal] = createSignal<string[]>([]);
const [workdirSelectedInternal, setWorkdirSelectedInternal] =
  createSignal<boolean>(false);
const [selectionAnchorInternal, setSelectionAnchorInternal] = createSignal<
  string | undefined
>(undefined);

export const selectedShas = selectedShasInternal;
export const workdirSelected = workdirSelectedInternal;
export const selectionAnchor = selectionAnchorInternal;

/// Youngest-selected sha, or `undefined` when nothing committed is
/// selected. Backward-compatible accessor for callers (right panel
/// resources, sidebar, toolbar) that still operate on a single sha.
export const selectedCommit = createMemo<string | undefined>(
  () => selectedShasInternal()[0],
);

/// Replace the selection wholesale. `shas` is youngest-first. `workdir`
/// flips the WIP pseudo-row's inclusion. The anchor follows the youngest
/// sha (or `undefined` when only the workdir is selected) so a follow-up
/// Shift+click extends from the most-recently-set row.
export function setSelection(shas: string[], workdir: boolean): void {
  setSelectedShasInternal(shas);
  setWorkdirSelectedInternal(workdir);
  setSelectionAnchorInternal(shas[0]);
}

/// Single-row select. Replaces any existing selection and clears the
/// workdir bit. Kept under the legacy `setSelectedCommit` name so existing
/// call sites (sidebar pulse, toolbar branch-jump, commit-context-menu
/// follow-up) need no churn.
export function setSelectedCommit(sha: string | undefined): void {
  if (sha === undefined) {
    setSelection([], false);
    return;
  }
  setSelection([sha], false);
}

/// Ctrl/Cmd+click — toggle `sha` in/out of the committed selection
/// without touching the workdir bit or the anchor.
export function toggleCommitInSelection(sha: string): void {
  const cur = selectedShasInternal();
  const idx = cur.indexOf(sha);
  if (idx >= 0) {
    const next = cur.slice();
    next.splice(idx, 1);
    setSelectedShasInternal(next);
    return;
  }
  setSelectedShasInternal([sha, ...cur]);
}

/// Shift+click — extend the selection from `selectionAnchor` to `sha`
/// using `orderedShas` (youngest-first; the order rows appear in the
/// graph). The walked range is appended to the existing selection,
/// de-duped while preserving youngest-first order. Without an anchor the
/// call collapses to a plain single-select on `sha`.
export function selectRangeTo(sha: string, orderedShas: string[]): void {
  const anchor = selectionAnchorInternal();
  if (!anchor || anchor === sha) {
    setSelectedCommit(sha);
    return;
  }
  const aIdx = orderedShas.indexOf(anchor);
  const bIdx = orderedShas.indexOf(sha);
  if (aIdx < 0 || bIdx < 0) {
    setSelectedCommit(sha);
    return;
  }
  const [lo, hi] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
  const range = orderedShas.slice(lo, hi + 1);
  // Existing selection wins on the head so the user's pre-shift picks
  // stay at the top; range tail is filtered against the existing set.
  const cur = selectedShasInternal();
  const seen = new Set(cur);
  const merged = cur.slice();
  for (const s of range) {
    if (!seen.has(s)) {
      merged.push(s);
      seen.add(s);
    }
  }
  setSelectedShasInternal(merged);
  // Anchor stays put — successive Shift+clicks all extend from the
  // original anchor (matches GK / Finder behaviour).
}

/// Toggle the WIP pseudo-row in the multi-select. Used by the WIP cell's
/// Ctrl/Cmd+click handler when the user wants to combine "this commit"
/// with "everything I haven't committed yet".
export function toggleWorkdirInSelection(): void {
  setWorkdirSelectedInternal((v) => !v);
}

/// Clear committed + workdir selection and the anchor.
export function clearSelection(): void {
  setSelectedShasInternal([]);
  setWorkdirSelectedInternal(false);
  setSelectionAnchorInternal(undefined);
}
