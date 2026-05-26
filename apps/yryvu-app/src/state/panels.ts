// SPDX-License-Identifier: AGPL-3.0-or-later

import { persistedBool } from "./storage";

export const [showLeftPanel, setShowLeftPanel] = persistedBool("showLeftPanel", true);
/// Right-panel open state migrated to `preferences.json` under
/// `layout.detailPanel.open` (issue #134, PR1). Use
/// `detailPanelOpen()` / `toggleDetailPanelOpen()` from
/// `state/detail-panel-layout.ts` instead. The legacy
/// `yryvu.showRightPanel` localStorage key is consumed once during
/// `AppShell` boot for migration, then removed.
export const [showTerminalPanel, setShowTerminalPanel] = persistedBool(
  "showTerminalPanel",
  false,
);

/// Collapse state for the Unstaged / Staged sections in the commit panel.
/// Persisted globally (not per-repo) — GK persists per-repo but the extra
/// bookkeeping is overkill until users ask for it.
export const [unstagedFilesCollapsed, setUnstagedFilesCollapsed] = persistedBool(
  "unstagedFilesCollapsed",
  false,
);
export const [stagedFilesCollapsed, setStagedFilesCollapsed] = persistedBool(
  "stagedFilesCollapsed",
  false,
);

/// `Commit Options` collapsible (skip hooks / GPG sign) below the message
/// box. Matches GK's `getPendingCommitOptionsExpanded`.
export const [pendingCommitOptionsExpanded, setPendingCommitOptionsExpanded] =
  persistedBool("pendingCommitOptionsExpanded", false);

/// Bypass pre-commit hooks. No-op on the git2 backend (libgit2 never
/// invokes hooks) but wired through for frontend/backend parity and so
/// future-gix migration picks up the flag for free.
export const [skipHooksEnabled, setSkipHooksEnabled] = persistedBool(
  "skipHooksEnabled",
  false,
);
