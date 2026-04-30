// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tab system types and constants. Ports the GitKraken tab subsystem
 * (audit doc `docs/research/gitkraken-tabs/01-tab-types-and-store.md`)
 * with chajá-specific simplifications:
 *
 * - CLI tab type omitted (no terminal in chajá — issue #25 is separate).
 * - FOCUS_VIEW omitted (GK Launchpad is proprietary).
 * - All telemetry fields and recordMetric calls dropped.
 *
 * The PersistedTab subset (in `ipc/preferences.ts`) is what survives across
 * app restarts. The runtime Tab adds in-memory metadata (closedAt,
 * originalIndex) that never crosses the IPC boundary.
 */

/// Permanent tab id literal — see audit doc 01 ("permanentTabIds === permanentTabTypes").
export const PERMANENT_REPO_MANAGEMENT_ID = "REPO_MANAGEMENT" as const;

/// `+` button DOM id (cited bundle:228929). Port verbatim — the dropdown
/// menu uses this id for keyboard focus return on close.
export const NEW_TAB_BUTTON_ID = "new-tab-button" as const;

/// Tooltip timing on truncated tab labels (cited bundle:228929).
export const TAB_TOOLTIP_HOVER_MS = 600;
export const TAB_TOOLTIP_RESET_MS = 300;
export const TAB_TOOLTIP_WIDTH = 250;

/// Recent repos cap on the NEW tab grid (cited bundle:182648).
export const RECENTLY_OPENED_LIMIT = 8;

/// Tab type union. Permanent tabs (REPO_MANAGEMENT) live in a separate
/// store key, not in the transient `tabs[]` array — see `state.ts`.
export type TabType = "REPO" | "NEW" | "RELEASE_NOTES";

/// All operation types the dispatcher understands. Ports
/// `Oa.tabOperationTypes` (cited bundle:228944-228957). MUTATE is the
/// in-place tab mutation that preserves `tabId` (cited bundle:2588).
export type TabOperationType =
  | "BULK_CLOSE"
  | "BULK_CREATE"
  | "CLOSE"
  | "CREATE"
  | "LOAD_TABS"
  | "MOVE"
  | "MUTATE"
  | "REOPEN"
  | "REOPEN_LAST_CLOSED"
  | "SWITCH_TO"
  | "SWITCH_TO_INDEX"
  | "SWITCH_TO_NEXT"
  | "SWITCH_TO_PREVIOUS";

/// Transient tab record. Discriminated by `type`. Repo tabs carry their
/// path; release-notes tabs capture the version at create time so a
/// long-running app session that auto-updates chajá doesn't drift the
/// open release-notes tab to a different version (cited bundle:2614).
export type Tab =
  | { type: "REPO"; id: string; repoPath: string; isWorktree: boolean }
  | { type: "NEW"; id: string }
  | { type: "RELEASE_NOTES"; id: string; version: string };

/// Closed tab entry. Adds `originalIndex` so REOPEN can re-insert at the
/// position where the user closed it (rather than always appending —
/// closing a leftmost tab and reopening it shouldn't shove it to the
/// right). `closedAt` is unix ms; not surfaced in UI but useful for
/// future debugging.
export interface ClosedTab {
  tab: Tab;
  closedAt: number;
  originalIndex: number;
}

/// Singleton state for a permanent tab. Only `closed` is meaningful;
/// the type/id are implied by the parent map's key.
export interface PermanentTabState {
  closed: boolean;
}

/// Permanent tabs map. Currently only REPO_MANAGEMENT.
export interface PermanentTabs {
  repoManagement?: PermanentTabState;
}

/// Tab operation payloads. Discriminated by `type` so the dispatcher
/// reducer can switch on it. Fields per op are minimal — they carry
/// just the data the reducer needs.
export type TabOp =
  | { type: "CREATE"; tabParams: Tab; switchToCreatedTab: boolean }
  | { type: "BULK_CREATE"; tabs: Tab[]; switchToFirst: boolean }
  | { type: "CLOSE"; tabId: string }
  | { type: "BULK_CLOSE"; tabIds: string[] }
  | { type: "MUTATE"; tabId: string; tabParams: Tab }
  | { type: "MOVE"; oldIndex: number; newIndex: number }
  | { type: "SWITCH_TO"; tabId: string }
  | { type: "SWITCH_TO_INDEX"; tabIndex: number }
  | { type: "SWITCH_TO_NEXT" }
  | { type: "SWITCH_TO_PREVIOUS" }
  | { type: "REOPEN"; tabId: string }
  | { type: "REOPEN_LAST_CLOSED" }
  | {
      type: "LOAD_TABS";
      tabs: Tab[];
      selectedTabId: string | undefined;
      permanentTabs: PermanentTabs;
    };
