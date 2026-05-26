// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

export type MainView =
  | "graph"
  | "diff"
  | "prDetail"
  | "issueDetail"
  | "fileHistory";
export const [mainView, setMainView] = createSignal<MainView>("graph");

export type SelectedDiffFile =
  | { kind: "commit"; sha: string; path: string }
  | { kind: "staging"; side: "unstaged" | "staged"; path: string };

export const [selectedDiffFile, setSelectedDiffFile] = createSignal<
  SelectedDiffFile | undefined
>(undefined);

export function openDiffTab(sha: string, path: string) {
  setSelectedDiffFile({ kind: "commit", sha, path });
  setMainView("diff");
}

export function openStagingDiffTab(
  side: "unstaged" | "staged",
  path: string,
) {
  setSelectedDiffFile({ kind: "staging", side, path });
  setMainView("diff");
}

export function closeDiffTab() {
  setSelectedDiffFile(undefined);
  setMainView("graph");
}

/// =============================================================================
/// File history panel (issue #7) — separate `mainView` slot so the
/// graph + diff tabs stay intact when the user toggles back from
/// history.
/// =============================================================================

export const [selectedHistoryFile, setSelectedHistoryFile] = createSignal<
  string | undefined
>(undefined);

export function openFileHistory(path: string): void {
  setSelectedHistoryFile(path);
  setMainView("fileHistory");
}

export function closeFileHistory(): void {
  setSelectedHistoryFile(undefined);
  setMainView("graph");
}
