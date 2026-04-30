// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Public tab operation sagas. Each function is a thin wrapper over
 * `performTabOperation` (dispatcher.ts) plus whatever pre/post coordination
 * the GK saga needed. 1:1 with the saga list at `audit doc 02`, minus:
 *
 * - `openFocusViewTab`     — Launchpad is GK-proprietary.
 * - `scheduleUpdateRepoTabCwd` — defer until worktrees UI needs it.
 * - `persistTabStateToProfile` — already lives in state.ts as `persistTabs`.
 *
 * Telemetry sagas (`sendTabMetric`, `recordMetric`) are dropped — chajá
 * ships no telemetry per audit doc 11.
 *
 * `crypto.randomUUID()` is used to mint tab ids (Tauri runs in WebKit2GTK
 * which has the API). Don't import a UUID dep just for this.
 */

import { performTabOperation } from "./dispatcher";
import { closedTabs, currentTab, permanentTabs, selectedTabId, tabs } from "./state";
import { PERMANENT_REPO_MANAGEMENT_ID, type Tab } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------------ Open */

/// Create a NEW tab and switch to it. Wired to the `+` button + Cmd+T.
export function openNewTab(): Promise<void> {
  return performTabOperation({
    type: "CREATE",
    switchToCreatedTab: true,
    tabParams: { type: "NEW", id: newId() },
  });
}

/// Open `repoPath` in another tab. If a REPO tab already exists for it,
/// switch to that. If the current tab is NEW (empty placeholder), reuse it
/// instead of opening a third tab.
export async function openRepoInAnotherTab(
  repoPath: string,
  isWorktree = false,
): Promise<void> {
  if (await switchToRepoTabIfItExists(repoPath)) return;
  if (currentTab()?.type === "NEW") {
    await openRepoInSelectedTab(repoPath, isWorktree);
    return;
  }
  await performTabOperation({
    type: "CREATE",
    switchToCreatedTab: true,
    tabParams: { type: "REPO", id: newId(), repoPath, isWorktree },
  });
}

/// Open `repoPath` in another tab WITHOUT switching to it. Used by the
/// "open in background" right-click menu entry.
export async function openRepoInAnotherTabWithoutSwitching(
  repoPath: string,
  isWorktree = false,
): Promise<void> {
  if (await switchToRepoTabIfItExists(repoPath)) return;
  await performTabOperation({
    type: "CREATE",
    switchToCreatedTab: false,
    tabParams: { type: "REPO", id: newId(), repoPath, isWorktree },
  });
}

/// Open `repoPath` in the currently-selected tab. MUTATEs in place when the
/// current tab is transient (preserves position + tabId), CREATEs otherwise
/// (e.g. when the permanent REPO_MANAGEMENT tab is selected).
export async function openRepoInSelectedTab(
  repoPath: string,
  isWorktree = false,
): Promise<void> {
  if (await switchToRepoTabIfItExists(repoPath)) return;
  const cur = currentTab();
  if (cur) {
    await performTabOperation({
      type: "MUTATE",
      tabId: cur.id,
      tabParams: { type: "REPO", id: cur.id, repoPath, isWorktree },
    });
    return;
  }
  await performTabOperation({
    type: "CREATE",
    switchToCreatedTab: true,
    tabParams: { type: "REPO", id: newId(), repoPath, isWorktree },
  });
}

/// Open the REPO_MANAGEMENT permanent tab. Auto-uncloses if it was closed.
/// chajá-side dropped: GK's projectId arg + workspace scroll/metric
/// (workspaces are proprietary — see audit doc 09).
export function openRepoManagementTab(): Promise<void> {
  return performTabOperation({
    type: "SWITCH_TO",
    tabId: PERMANENT_REPO_MANAGEMENT_ID,
  });
}

/// Open RELEASE_NOTES tab. Singleton-enforced: if one is open already,
/// SWITCH_TO it; otherwise CREATE one capturing the current app version.
export async function openReleaseNotes(version: string): Promise<void> {
  const cur = currentTab();
  if (cur?.type === "RELEASE_NOTES") return;
  const existing = tabs().find((t) => t.type === "RELEASE_NOTES");
  if (existing) {
    await performTabOperation({ type: "SWITCH_TO", tabId: existing.id });
    return;
  }
  await performTabOperation({
    type: "CREATE",
    switchToCreatedTab: true,
    tabParams: { type: "RELEASE_NOTES", id: newId(), version },
  });
}

/* ---------------------------------------------------------------- Switch */

export function selectNextTab(): Promise<void> {
  return performTabOperation({ type: "SWITCH_TO_NEXT" });
}

export function selectPreviousTab(): Promise<void> {
  return performTabOperation({ type: "SWITCH_TO_PREVIOUS" });
}

export function selectTabIndex(index: number): Promise<void> {
  return performTabOperation({ type: "SWITCH_TO_INDEX", tabIndex: index });
}

/// Returns true (and switches) if a REPO tab for `repoPath` exists.
/// Returns false (no-op) otherwise. Caller decides the fallback (CREATE etc).
export async function switchToRepoTabIfItExists(
  repoPath: string,
): Promise<boolean> {
  const idx = tabs().findIndex(
    (t) => t.type === "REPO" && t.repoPath === repoPath,
  );
  if (idx < 0) return false;
  await performTabOperation({ type: "SWITCH_TO_INDEX", tabIndex: idx });
  return true;
}

/* ----------------------------------------------------------------- Close */

/// Close the currently-selected tab.
export function closeSelectedTab(): Promise<void> {
  const id = selectedTabId();
  if (!id) return Promise.resolve();
  return performTabOperation({ type: "CLOSE", tabId: id });
}

/// Cmd+W handler. GK runs a 3-stage cascade (close file-history → close
/// file-view → close tab, see audit doc 05). For chajá v1 we only have the
/// last stage (no file-history widget, no file-view collapsible). The saga
/// keeps the name + signature so future cascade additions slot in here
/// without re-wiring the keybind.
export function handleCloseTabShortcut(): Promise<void> {
  // TODO(file-history #?): if a file-history overlay opens, close it first.
  // TODO(file-view #?): if the file-view pane is expanded, collapse it first.
  return closeSelectedTab();
}

/// Close every tab of the given type. Used internally on workspace remove.
export function closeAllTabsOfType(tabType: Tab["type"]): Promise<void> {
  const ids = tabs()
    .filter((t) => t.type === tabType)
    .map((t) => t.id);
  if (ids.length === 0) return Promise.resolve();
  return performTabOperation({ type: "BULK_CLOSE", tabIds: ids });
}

/// Close every REPO tab whose repoPath matches one of the given paths.
/// Used when a workspace is removed or a directory is deleted out from
/// under chajá. Path matching is case- and separator-sensitive — callers
/// should normalize beforehand.
export function closeOpenedRepoTabsByPaths(paths: string[]): Promise<void> {
  const set = new Set(paths);
  const ids = tabs()
    .filter((t) => t.type === "REPO" && set.has(t.repoPath))
    .map((t) => t.id);
  if (ids.length === 0) return Promise.resolve();
  return performTabOperation({ type: "BULK_CLOSE", tabIds: ids });
}

/* ---------------------------------------------------------------- Mutate */

/// MUTATE the selected tab into a NEW tab — preserves the tabId so the
/// React/Solid reconciler keeps the DOM node (cited bundle:2588). Falls
/// through to CREATE when selection is on the permanent REPO_MANAGEMENT
/// pill (which can't be mutated into a transient type).
export async function replaceSelectedTabWithNewTab(): Promise<void> {
  const id = selectedTabId();
  const cur = currentTab();
  if (cur && id) {
    await performTabOperation({
      type: "MUTATE",
      tabId: id,
      tabParams: { type: "NEW", id },
    });
    return;
  }
  // Selection is on the permanent tab or no selection — create a fresh
  // NEW tab and switch to it.
  await openNewTab();
}

/* ---------------------------------------------------------------- Reopen */

/// Reopen a specific closed tab by id. No-op if `tabId` isn't on the stack.
export function reopenTab(tabId: string): Promise<void> {
  return performTabOperation({ type: "REOPEN", tabId });
}

/// Reopen the most-recently closed tab. Cmd+Shift+T.
export function reopenMostRecentlyClosedTab(): Promise<void> {
  if (closedTabs().length === 0) return Promise.resolve();
  return performTabOperation({ type: "REOPEN_LAST_CLOSED" });
}

/* ----------------------------------------------------------- Permanent tab */

/// Toggle the permanent REPO_MANAGEMENT tab's `closed` flag. Closing a
/// permanent tab doesn't push to closedTabs (singletons can't be reopened
/// via the dropdown — they're toggled via menu).
export function closeRepoManagementTab(): Promise<void> {
  // Direct mutation via dispatcher MUTATE-style isn't right here — the
  // permanent tab map isn't part of `tabs[]`. We need a small ad-hoc
  // setter via the LOAD_TABS op shape.
  const cur = permanentTabs();
  return performTabOperation({
    type: "LOAD_TABS",
    tabs: tabs(),
    selectedTabId:
      selectedTabId() === PERMANENT_REPO_MANAGEMENT_ID
        ? tabs()[0]?.id
        : selectedTabId(),
    permanentTabs: {
      ...cur,
      repoManagement: { closed: true },
    },
  });
}
