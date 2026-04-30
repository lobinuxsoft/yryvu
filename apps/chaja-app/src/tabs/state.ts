// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tab system Solid signals + hydration + persistence.
 *
 * Three persisted signals (`tabs / selectedTabId / permanentTabs`) and one
 * in-memory only (`closedTabs`). Matches GK's `tabInfo` envelope at
 * bundle:2373-2381 — `closedTabs` is intentionally NOT persisted (audit
 * doc 06 confirms via the absence of the field in `persistTabStateToProfile`).
 *
 * Hydration happens once at app boot via `hydrateTabsFromPreferences`. After
 * that, every mutation triggers a debounced `persistTabs` to round-trip
 * the three persisted fields back to the backend.
 *
 * The dispatcher (`dispatcher.ts`) is the only writer — all signal mutators
 * are exported as `_internal*` so external code routes through ops, not
 * direct writes. This mirrors GK's saga + reducer split where every change
 * flows through `performTabOperation`.
 */

import { createMemo, createSignal } from "solid-js";

import {
  getPreferences,
  setPreferences,
  type PermanentTabs as PersistedPermanentTabs,
  type Preferences,
} from "../ipc/preferences";
import {
  PERMANENT_REPO_MANAGEMENT_ID,
  type ClosedTab,
  type PermanentTabs,
  type Tab,
} from "./types";

/// Signals — internal mutators kept module-private (re-exported as
/// `_internal*` only for the dispatcher). External callers use ops.
const [tabsInternal, _internalSetTabs] = createSignal<Tab[]>([]);
const [selectedTabIdInternal, _internalSetSelectedTabId] =
  createSignal<string | undefined>(undefined);
const [closedTabsInternal, _internalSetClosedTabs] = createSignal<ClosedTab[]>(
  [],
);
const [permanentTabsInternal, _internalSetPermanentTabs] =
  createSignal<PermanentTabs>({});
const [isTabBeingDraggedInternal, _internalSetIsTabBeingDragged] =
  createSignal(false);

/// Read-only signal exports.
export const tabs = tabsInternal;
export const selectedTabId = selectedTabIdInternal;
export const closedTabs = closedTabsInternal;
export const permanentTabs = permanentTabsInternal;
export const isTabBeingDragged = isTabBeingDraggedInternal;

/// Re-exports for the dispatcher only. Keep the underscore prefix —
/// importing these outside `dispatcher.ts` is a lint smell.
export const _internal = {
  setTabs: _internalSetTabs,
  setSelectedTabId: _internalSetSelectedTabId,
  setClosedTabs: _internalSetClosedTabs,
  setPermanentTabs: _internalSetPermanentTabs,
  setIsTabBeingDragged: _internalSetIsTabBeingDragged,
};

/// Memos — derived state. `currentTab` resolves the selected id against
/// both the transient list and permanent tabs map, since `selectedTabId`
/// can hold either a UUID (transient) or `"REPO_MANAGEMENT"` (permanent).
export const currentTab = createMemo<Tab | undefined>(() => {
  const id = selectedTabIdInternal();
  if (!id) return undefined;
  if (id === PERMANENT_REPO_MANAGEMENT_ID) {
    // Permanent tab type isn't in the Tab union — callers that need to
    // distinguish should compare `currentTabType()` against the literal.
    return undefined;
  }
  return tabsInternal().find((t) => t.id === id);
});

/// `currentTabType` returns the type even when the selected tab is permanent
/// (where `currentTab` returns undefined). Use this when you need to switch
/// on the active tab type for content rendering.
export const currentTabType = createMemo<
  Tab["type"] | "REPO_MANAGEMENT" | undefined
>(() => {
  const id = selectedTabIdInternal();
  if (!id) return undefined;
  if (id === PERMANENT_REPO_MANAGEMENT_ID) return "REPO_MANAGEMENT";
  return currentTab()?.type;
});

/// `canReopen` — reactive `closedTabs().length > 0`. Used to disable the
/// "Reopen last closed" UI affordance.
export const canReopen = createMemo(() => closedTabsInternal().length > 0);

/// `mostRecentlyClosed` — top of the closed-tabs LIFO. Used by Cmd+Shift+T
/// and by the dropdown's "Closed Recently" head row.
export const mostRecentlyClosed = createMemo<ClosedTab | undefined>(() => {
  const stack = closedTabsInternal();
  return stack.length > 0 ? stack[stack.length - 1] : undefined;
});

/// Hydration: load the persisted slice from preferences and seed the signals.
/// Idempotent — calling twice is a no-op (the second call overwrites with
/// the same data). Called from AppShell at boot.
let hydrated = false;
let cachedPreferences: Preferences | undefined;

export async function hydrateTabsFromPreferences(): Promise<void> {
  if (hydrated) return;
  const prefs = await getPreferences();
  cachedPreferences = prefs;
  // Defensive: the backend ships `isWorktree` as bool always (Rust default
  // = false), but a hand-edited file could omit it. Coerce.
  const seededTabs: Tab[] = prefs.tabs.tabs.map((t) => {
    if (t.type === "REPO") {
      return {
        type: "REPO",
        id: t.id,
        repoPath: t.repoPath,
        isWorktree: Boolean(t.isWorktree),
      };
    }
    if (t.type === "RELEASE_NOTES") {
      return { type: "RELEASE_NOTES", id: t.id, version: t.version };
    }
    return { type: "NEW", id: t.id };
  });
  _internalSetTabs(seededTabs);
  _internalSetSelectedTabId(prefs.tabs.selectedTabId);
  _internalSetPermanentTabs(prefs.tabs.permanentTabs as PermanentTabs);
  hydrated = true;
}

/// Persist the three persisted fields back to the backend. Debounced so a
/// burst of ops (e.g. `LOAD_TABS` followed by `SWITCH_TO`) collapses into
/// one IPC call. Frontend never resets `version` — the backend owns it.
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const PERSIST_DEBOUNCE_MS = 250;

export function persistTabs(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void persistImmediate();
  }, PERSIST_DEBOUNCE_MS);
}

async function persistImmediate(): Promise<void> {
  // If hydration hasn't finished, the cached prefs envelope isn't ready —
  // skip rather than send a half-built object that could clobber the file.
  if (!cachedPreferences) return;
  const next: Preferences = {
    ...cachedPreferences,
    tabs: {
      tabs: tabsInternal().map((t) => {
        if (t.type === "REPO") {
          return {
            type: "REPO",
            id: t.id,
            repoPath: t.repoPath,
            isWorktree: t.isWorktree,
          };
        }
        if (t.type === "RELEASE_NOTES") {
          return { type: "RELEASE_NOTES", id: t.id, version: t.version };
        }
        return { type: "NEW", id: t.id };
      }),
      selectedTabId: selectedTabIdInternal(),
      permanentTabs: permanentTabsInternal() as PersistedPermanentTabs,
    },
  };
  cachedPreferences = await setPreferences(next);
}

/// Test-only escape hatch — resets the hydration latch so tests can re-seed
/// fresh state between runs. NOT exported from the public surface.
export function _resetForTests(): void {
  hydrated = false;
  cachedPreferences = undefined;
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  _internalSetTabs([]);
  _internalSetSelectedTabId(undefined);
  _internalSetClosedTabs([]);
  _internalSetPermanentTabs({});
  _internalSetIsTabBeingDragged(false);
}
