// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Left sidebar sizing + visibility (issue #36). Mirrors GK's
 * `layout.RefPanel.{width, open}` per audit doc
 * `gitkraken-left-panel/00-overview.md`.
 *
 * Same shape + cadence as `state/detail-panel-layout.ts`: two Solid
 * signals hydrated from `preferences.json` at boot, debounced persist
 * on every mutation, pair of `clampWidth` / pointer-end commit hooks
 * for the drag wrapper. The debounce is per-domain so a sidebar drag
 * during a tab close doesn't cross-fire, but the envelope itself is
 * read and written through `state/preferences.ts` — holding a private
 * copy is what let one panel's write revert another's.
 */

import { createEffect, createSignal } from "solid-js";

import { type LeftSidebarLayout } from "../ipc/preferences";

import { mutatePreferences, preferencesReady } from "./preferences";

/// Collapsed-rail width acts as the floor (same value as the legacy
/// `--panel-width-left-collapsed` token). GK doesn't expose its
/// min/max as constants — they're computed at render time — so a
/// hard 44 px keeps the rail usable when the user drags fully closed.
export const MIN_WIDTH = 44;

/// Clamp the sidebar width against the floor and the live viewport
/// ceiling. `maxWidth` is the largest width the caller can honor
/// without overlapping the rest of the shell — callers compute it
/// from `window.innerWidth` minus reserved chrome (inspector width,
/// minimum main viewport).
export function clampWidth(width: number, maxWidth: number): number {
  if (!Number.isFinite(width)) return MIN_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(width, Math.max(MIN_WIDTH, maxWidth)));
}

const [widthInternal, _internalSetWidth] = createSignal<number>(215);
const [openInternal, _internalSetOpen] = createSignal<boolean>(true);

export const leftSidebarWidth = widthInternal;
export const leftSidebarOpen = openInternal;

let hydrated = false;

export async function hydrateLeftSidebarLayout(): Promise<void> {
  if (hydrated) return;
  const prefs = await preferencesReady();
  _internalSetWidth(prefs.layout.leftSidebar.width);
  _internalSetOpen(prefs.layout.leftSidebar.open);
  hydrated = true;
}

const PERSIST_DEBOUNCE_MS = 250;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function schedulePersist(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void persistImmediate();
  }, PERSIST_DEBOUNCE_MS);
}

async function persistImmediate(): Promise<void> {
  // Until hydration lands, the signals still hold this module's
  // defaults — writing them would clobber the saved width.
  if (!hydrated) return;
  await mutatePreferences((current) => ({
    ...current,
    layout: {
      ...current.layout,
      leftSidebar: {
        width: widthInternal(),
        open: openInternal(),
      } satisfies LeftSidebarLayout,
    },
  }));
}

export function setLeftSidebarWidth(width: number, persist = true): void {
  _internalSetWidth(width);
  if (persist) schedulePersist();
}

export function setLeftSidebarOpen(open: boolean): void {
  _internalSetOpen(open);
  schedulePersist();
}

export function toggleLeftSidebarOpen(): void {
  setLeftSidebarOpen(!openInternal());
}

/// Force a persist immediately (e.g. drag-end after a stream of
/// non-persisted updates). No-op when hydration hasn't finished.
export function commitLeftSidebarLayout(): void {
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  void persistImmediate();
}

/// Test-only escape hatch — resets the hydration latch so tests can
/// re-seed fresh state. Not exported from any public barrel.
export function _resetForTests(): void {
  hydrated = false;
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  _internalSetWidth(215);
  _internalSetOpen(true);
}

createEffect(() => {
  void widthInternal();
  void openInternal();
});
