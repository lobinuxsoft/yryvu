// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Aggregator for the per-domain state slices. Every consumer continues
 * importing from `../state` (or `../../state`); the directory split is
 * an internal detail.
 *
 * Order of re-exports below mirrors the original monolithic file's
 * declaration order — easier to diff, and keeps `setRepoPath` near the
 * bottom because it depends on every clear/reset surface above it.
 */

export { repoPath } from "./repo-base";
export { setRepoPath } from "./repo";
export {
  showLeftPanel,
  setShowLeftPanel,
  showRightPanel,
  setShowRightPanel,
  showTerminalPanel,
  setShowTerminalPanel,
  unstagedFilesCollapsed,
  setUnstagedFilesCollapsed,
  stagedFilesCollapsed,
  setStagedFilesCollapsed,
  pendingCommitOptionsExpanded,
  setPendingCommitOptionsExpanded,
  skipHooksEnabled,
  setSkipHooksEnabled,
} from "./panels";
export {
  selectedShas,
  workdirSelected,
  selectionAnchor,
  selectedCommit,
  setSelection,
  setSelectedCommit,
  toggleCommitInSelection,
  selectRangeTo,
  toggleWorkdirInSelection,
  clearSelection,
} from "./selection";
export {
  mainView,
  setMainView,
  selectedDiffFile,
  setSelectedDiffFile,
  openDiffTab,
  openStagingDiffTab,
  closeDiffTab,
  type MainView,
  type SelectedDiffFile,
} from "./diff";
export {
  inspectorMode,
  setInspectorMode,
  hoveredRef,
  setHoveredRef,
  clearHoveredRef,
  pinnedSha,
  setPinnedSha,
  type HoveredRef,
  type HoveredRefKind,
  type InspectorMode,
} from "./inspector";
export {
  commitMessage,
  setCommitMessage,
  commitDescription,
  setCommitDescription,
  amendEnabled,
  setAmendEnabled,
} from "./commit-draft";
export {
  workingTreeNonce,
  setWorkingTreeNonce,
  refreshWorkingTree,
  undoRedoNonce,
  setUndoRedoNonce,
  refreshUndoRedo,
  graphNonce,
  setGraphNonce,
  refreshGraph,
  branchesNonce,
  setBranchesNonce,
  refreshBranches,
  workingTreeStatus,
  undoRedoState,
  dirtyFileCount,
} from "./refresh";
export { hiddenRefs, setHiddenRef, clearHiddenRefs } from "./refs";
export {
  ALL_SECTION_KEYS,
  ALWAYS_VISIBLE_SECTION_KEYS,
  hiddenSections,
  expandedSections,
  toggleSectionExpanded,
  maximizeSection,
  toggleSectionHidden,
  type SectionKey,
} from "./sections";
export {
  graphColumns,
  graphContainerWidth,
  commitZoneMode,
  activeColumnSettings,
  activeOrderedZones,
  setGraphZoneWidth,
  setGraphZoneWidthInteractive,
  commitGraphColumnLayout,
  setGraphZoneVisible,
  setCommitZoneMode,
  toggleCommitZoneMode,
  resetColumnsToDefaultLayout,
  resetColumnsToCompactLayout,
  ensureColumnWidthsFitContainer,
} from "./columns";
export { pullType, setPullType, type PullType } from "./pull";
export {
  smartBranchesEnabled,
  setSmartBranchesEnabled,
  hiddenBySmartFilter,
  setHiddenBySmartFilter,
} from "./smart-branches";
export {
  loadRecentRepos,
  pushRecentRepo,
  removeRecentRepo,
  type RecentRepo,
} from "./recent-repos";
export {
  pendingRefNav,
  navigateToRef,
  clearPendingRefNav,
  type RefNavRequest,
} from "./refNavigation";
export {
  PREFERENCE_SECTION_IDS,
  preferencesOpen,
  setPreferencesOpen,
  activePreferenceSection,
  setActivePreferenceSection,
  openPreferences,
  closePreferences,
  preferences,
  updatePreferences,
  resetPreferences,
  type PreferenceSectionId,
} from "./preferences";
