// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tab operation dispatcher. Single chokepoint for every state mutation —
 * mirrors GK's saga channel at bundle:1795-2195 (audit doc 02), but built
 * on a Promise-chained queue instead of redux-saga channels.
 *
 * Two guarantees the queue is responsible for:
 *
 * 1. **FIFO**: ops applied in submission order even when callers fire
 *    concurrently. A `Cmd+W` racing a tab pill click can't interleave
 *    half a CLOSE with half a SWITCH_TO.
 * 2. **Serialization**: each op completes (mutations + persist) before
 *    the next starts. The reducer never sees a half-applied prior op.
 *
 * Errors in one op don't kill the queue — `queue.catch(() => {})` swallows
 * the rejection so subsequent ops still run. The original promise still
 * rejects to the caller.
 */

import {
  PERMANENT_REPO_MANAGEMENT_ID,
  type ClosedTab,
  type Tab,
  type TabOp,
} from "./types";
import {
  _internal,
  closedTabs,
  permanentTabs,
  persistTabs,
  selectedTabId,
  tabs,
} from "./state";

/// FIFO queue. Each enqueued op chains off the previous one so they apply
/// in submission order. The `.catch` keeps the queue alive on errors.
let queue: Promise<void> = Promise.resolve();

export function performTabOperation(op: TabOp): Promise<void> {
  const next = queue.then(() => applyOp(op));
  queue = next.catch(() => {
    // intentional — keep the queue alive; the original promise still
    // rejects to the caller below
  });
  return next;
}

async function applyOp(op: TabOp): Promise<void> {
  switch (op.type) {
    case "CREATE":
      applyCreate(op.tabParams, op.switchToCreatedTab);
      break;
    case "BULK_CREATE":
      applyBulkCreate(op.tabs, op.switchToFirst);
      break;
    case "CLOSE":
      applyClose(op.tabId);
      break;
    case "BULK_CLOSE":
      applyBulkClose(op.tabIds);
      break;
    case "MUTATE":
      applyMutate(op.tabId, op.tabParams);
      break;
    case "MOVE":
      applyMove(op.oldIndex, op.newIndex);
      break;
    case "SWITCH_TO":
      applySwitchTo(op.tabId);
      break;
    case "SWITCH_TO_INDEX":
      applySwitchToIndex(op.tabIndex);
      break;
    case "SWITCH_TO_NEXT":
      applySwitchToOffset(1);
      break;
    case "SWITCH_TO_PREVIOUS":
      applySwitchToOffset(-1);
      break;
    case "REOPEN":
      applyReopen(op.tabId);
      break;
    case "REOPEN_LAST_CLOSED":
      applyReopenLastClosed();
      break;
    case "LOAD_TABS":
      applyLoad(op.tabs, op.selectedTabId, op.permanentTabs);
      break;
  }
  persistTabs();
}

function applyCreate(tab: Tab, switchTo: boolean): void {
  _internal.setTabs([...tabs(), tab]);
  if (switchTo) _internal.setSelectedTabId(tab.id);
}

function applyBulkCreate(newTabs: Tab[], switchToFirst: boolean): void {
  if (newTabs.length === 0) return;
  _internal.setTabs([...tabs(), ...newTabs]);
  if (switchToFirst) _internal.setSelectedTabId(newTabs[0].id);
}

function applyClose(tabId: string): void {
  const list = tabs();
  const idx = list.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  const tab = list[idx];
  // NEW tabs don't enter the closed-tabs stack — there's nothing to
  // reopen. Matches GK's filter: only meaningful tab types are
  // restorable. This collapses the user-features filter from
  // `getReopenableTabs` (bundle:372932) into a single explicit check
  // since chajá has no tiering.
  if (tab.type !== "NEW") {
    pushClosed({ tab, closedAt: Date.now(), originalIndex: idx });
  }
  const next = [...list.slice(0, idx), ...list.slice(idx + 1)];
  _internal.setTabs(next);
  // If the closed tab was selected, pick a fallback: previous tab if
  // any, else next tab if any, else the permanent REPO_MANAGEMENT pill
  // if visible, else nothing.
  if (selectedTabId() === tabId) {
    const fallback =
      next[idx - 1]?.id ??
      next[idx]?.id ??
      (permanentTabs().repoManagement?.closed === false
        ? PERMANENT_REPO_MANAGEMENT_ID
        : undefined);
    _internal.setSelectedTabId(fallback);
  }
}

function applyBulkClose(tabIds: string[]): void {
  // Close one by one so the closed-tabs stack and selection-fallback
  // logic apply uniformly. Cheap enough for typical bulk sizes.
  for (const id of tabIds) applyClose(id);
}

function applyMutate(tabId: string, tabParams: Tab): void {
  // MUTATE preserves the tab's array index AND re-uses the existing
  // tabId — this is what lets a MUTATE dispatch flip a REPO
  // tab into NEW without remounting (cited bundle:2588). Override the
  // params' id with the original to enforce the contract even if the
  // caller passed a fresh one.
  const list = tabs();
  const idx = list.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  const next = [...list];
  next[idx] = { ...tabParams, id: tabId };
  _internal.setTabs(next);
}

function applyMove(oldIndex: number, newIndex: number): void {
  const list = tabs();
  if (oldIndex < 0 || oldIndex >= list.length) return;
  if (newIndex < 0 || newIndex >= list.length) return;
  if (oldIndex === newIndex) return;
  const next = [...list];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);
  _internal.setTabs(next);
}

function applySwitchTo(tabId: string): void {
  if (tabId === PERMANENT_REPO_MANAGEMENT_ID) {
    // Auto-uncloses the permanent pill (matches GK's reducer at
    // bundle:1947 where SWITCH_TO with a permanent id sets `closed: false`).
    _internal.setPermanentTabs({
      ...permanentTabs(),
      repoManagement: { closed: false },
    });
    _internal.setSelectedTabId(tabId);
    return;
  }
  if (!tabs().some((t) => t.id === tabId)) return;
  _internal.setSelectedTabId(tabId);
}

function applySwitchToIndex(index: number): void {
  const list = tabs();
  if (index < 0 || index >= list.length) return;
  _internal.setSelectedTabId(list[index].id);
}

function applySwitchToOffset(delta: number): void {
  const list = tabs();
  if (list.length === 0) return;
  const id = selectedTabId();
  // If selection is on the permanent tab or undefined, treat it as
  // index -1 so the +1 lands on the first transient tab.
  const cur =
    id && id !== PERMANENT_REPO_MANAGEMENT_ID
      ? list.findIndex((t) => t.id === id)
      : -1;
  const next = ((cur + delta) % list.length + list.length) % list.length;
  _internal.setSelectedTabId(list[next].id);
}

function applyReopen(tabId: string): void {
  const stack = closedTabs();
  const idx = stack.findIndex((c) => c.tab.id === tabId);
  if (idx < 0) return;
  const entry = stack[idx];
  reinsertClosed(entry);
  _internal.setClosedTabs([...stack.slice(0, idx), ...stack.slice(idx + 1)]);
}

function applyReopenLastClosed(): void {
  const stack = closedTabs();
  if (stack.length === 0) return;
  const entry = stack[stack.length - 1];
  reinsertClosed(entry);
  _internal.setClosedTabs(stack.slice(0, -1));
}

function applyLoad(
  newTabs: Tab[],
  newSelectedTabId: string | undefined,
  newPermanentTabs: { repoManagement?: { closed: boolean } },
): void {
  _internal.setTabs(newTabs);
  _internal.setSelectedTabId(newSelectedTabId);
  _internal.setPermanentTabs(newPermanentTabs);
}

function pushClosed(entry: ClosedTab): void {
  _internal.setClosedTabs([...closedTabs(), entry]);
}

function reinsertClosed(entry: ClosedTab): void {
  const list = tabs();
  const insertAt = Math.max(0, Math.min(entry.originalIndex, list.length));
  const next = [
    ...list.slice(0, insertAt),
    entry.tab,
    ...list.slice(insertAt),
  ];
  _internal.setTabs(next);
  _internal.setSelectedTabId(entry.tab.id);
}
