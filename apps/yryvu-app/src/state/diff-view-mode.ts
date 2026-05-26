// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Issue #59 — `fileDisplayModes` parity with GitKraken.
 *
 * The full four-value enum drives both the File-View vs Diff-View outer
 * toggle and the Hunk / Inline / Split inner toggle. Mode persists
 * per-profile (across repos), mirroring GK's `ui.diffView.diffDisplayMode`
 * Redux path — we use `localStorage` since yryvu's "profile" is the
 * browser-side install, not a cloud-synced account.
 */

import { createSignal, type Accessor } from "solid-js";

import { persistedEnum } from "./storage";

export const FILE_VIEW_MODES = ["content", "hunk", "inline", "split"] as const;
export type FileViewMode = (typeof FILE_VIEW_MODES)[number];

export const DIFF_VIEW_MODES = ["hunk", "inline", "split"] as const;
export type DiffViewMode = (typeof DIFF_VIEW_MODES)[number];

/// Persisted current mode. Default `hunk` — same as GK's init state.
export const [fileViewMode, setFileViewMode] = persistedEnum<FileViewMode>(
  "fileViewMode",
  "hunk",
  FILE_VIEW_MODES,
);

/// Last diff-mode (Hunk / Inline / Split) chosen — restored when the
/// outer toggle flips back from File to Diff. Independent persistence
/// so toggling File→Diff returns the user to their last diff variant.
const [lastDiffMode, setLastDiffMode] = persistedEnum<DiffViewMode>(
  "lastDiffViewMode",
  "hunk",
  DIFF_VIEW_MODES,
);

export { lastDiffMode };

/// Switch into one of the three diff modes. Records the choice as the
/// last-used diff mode so the File↔Diff outer toggle can restore it.
export function setDiffViewMode(mode: DiffViewMode): void {
  setLastDiffMode(mode);
  setFileViewMode(mode);
}

/// Outer-toggle switcher. Going to "diff" restores the last diff mode.
export function setOuterView(view: "file" | "diff"): void {
  if (view === "file") {
    setFileViewMode("content");
    return;
  }
  setFileViewMode(lastDiffMode());
}

/// Convenience: is the diff toolbar (inner toggle) visible?
export const isDiffMode: Accessor<boolean> = () => fileViewMode() !== "content";

/// =============================================================================
/// Prev/next change navigation — Redux-equivalent signal channel.
///
/// The diff body registers (next, prev) callbacks every time it loads
/// a new file (mirror of GK's `GoToNextAndPreviousDiffChangeCbsUpdated`
/// dispatch); the toolbar reads them on click. Solid signals are the
/// natural shared channel since the toolbar lives in a sibling tree
/// from the editor body.
/// =============================================================================

export interface DiffNavigator {
  next: () => void;
  prev: () => void;
}

const [diffNavigator, setDiffNavigator] = createSignal<DiffNavigator | null>(
  null,
);
export { diffNavigator, setDiffNavigator };

/// Clear the channel — call when the diff body unmounts so a click on
/// the toolbar after the editor is gone doesn't fire a stale callback.
export function clearDiffNavigator(): void {
  setDiffNavigator(null);
}
