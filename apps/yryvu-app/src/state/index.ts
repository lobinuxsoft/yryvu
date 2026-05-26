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
  selectedHistoryFile,
  setSelectedHistoryFile,
  openFileHistory,
  closeFileHistory,
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
  signCommitEnabled,
  setSignCommitEnabled,
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
  setGraphZonePairInteractive,
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
export {
  FILE_VIEW_MODES,
  DIFF_VIEW_MODES,
  fileViewMode,
  setFileViewMode,
  setDiffViewMode,
  setOuterView,
  isDiffMode,
  outerView,
  diffNavigator,
  setDiffNavigator,
  clearDiffNavigator,
  type FileViewMode,
  type DiffViewMode,
  type DiffNavigator,
  type OuterView,
} from "./diff-view-mode";
export {
  recentlyCreatedSha,
  highlightedSha,
  flashCommitCreated,
  flashCommitHighlight,
} from "./commit-animations";
export { repoState, hasConflicts } from "./repo-state";
export { prsByHeadSha } from "./prs-by-head-sha";
export {
  dragPayload,
  dragTarget,
  dropPopover,
  beginDrag,
  setDropTarget,
  endDrag,
  openDropPopover,
  closeDropPopover,
  resolveDropActions,
  type DragPayload,
  type DragTarget,
  type DropAction,
  type DropActionId,
  type DropPopover,
} from "./dnd";
export {
  commitFilter,
  setCommitFilter,
  clearCommitFilter,
  reloadCommitFilterForRepo,
  isCommitFilterActive,
  isFilterEmpty,
  matchesCommitFilter,
  matchesCommitFilterWithPath,
  pathShaSet,
  EMPTY_FILTER,
  type CommitFilter,
} from "./commit-filter";
// `issue-tracker` is intentionally NOT re-exported here. It imports
// `./preferences` whose `createResource` fetcher fires `invoke()` at
// module-eval time; pulling that into the barrel would force every
// consumer of `state` (including node-env tests that only need
// `repoPath`) to drag in `@tauri-apps/api/core`. Consumers that need
// the issue-tracker signals import directly from `state/issue-tracker`.
