// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Signal } from "solid-js";

import { STORAGE_PREFIX, persistedBool } from "./storage";

export const [showLeftPanel, setShowLeftPanel] = persistedBool("showLeftPanel", true);
export const [showRightPanel, setShowRightPanel] = persistedBool("showRightPanel", true);
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

export type Theme = "dark" | "light";

function persistedTheme(): Signal<Theme> {
  const stored = localStorage.getItem(STORAGE_PREFIX + "theme");
  const initial: Theme = stored === "light" ? "light" : "dark";
  const [value, setValue] = createSignal<Theme>(initial);
  const wrapped: Signal<Theme>[1] = ((next: Theme | ((prev: Theme) => Theme)) => {
    const resolved = typeof next === "function" ? next(value()) : next;
    localStorage.setItem(STORAGE_PREFIX + "theme", resolved);
    return setValue(resolved);
  }) as Signal<Theme>[1];
  return [value, wrapped];
}

export const [theme, setTheme] = persistedTheme();
