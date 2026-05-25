// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Right-side inspector panel sizing + visibility (issue #134, PR1).
 * Mirrors GK's `layout.DetailPanel.{width, height, open}` per audit
 * doc `01-panel-chrome.md`.
 *
 * Three Solid signals (`width / height / open`) hydrated from
 * `preferences.json` at boot and persisted (debounced) on every
 * mutation. Pure-function helpers (`clampWidth / clampHeight`) are
 * exported separately so they can be unit-tested without the signal
 * machinery, mirroring the split used by `tabs/state.ts`.
 *
 * Why a separate persistence cycle (vs the existing `tabs/state.ts`
 * one): each domain owns its own envelope round-trip — the tab system
 * and the inspector mutate at different cadences and a shared
 * debouncer would either over-fire (panel drag during a tab close)
 * or under-fire (single batched IPC for both). Splitting per-domain
 * keeps the IPC granular and reads cleaner under the inspector.
 */

import { createEffect, createSignal } from "solid-js";

import {
  getPreferences,
  setPreferences,
  type DetailPanelLayout,
  type Preferences,
} from "../ipc/preferences";

/// GK verbatim per audit doc `01-panel-chrome.md` — bundle clamps
/// `width: clamp(353, current, max)` and `height: clamp(566, current, max)`
/// on every render so a viewport shrink shrinks the panel instead of
/// overflowing the chrome.
export const MIN_WIDTH = 353;
export const MIN_HEIGHT = 566;

/// Clamp the panel width against the min and the current viewport.
/// `maxWidth` is the largest viewport-derived ceiling the caller can
/// honor without overlapping the rest of the shell. GK uses
/// `window.innerWidth - 651` as a rule of thumb; we pass it in so the
/// callsite can compute it from real `clientWidth` measurements.
export function clampWidth(width: number, maxWidth: number): number {
  if (!Number.isFinite(width)) return MIN_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(width, Math.max(MIN_WIDTH, maxWidth)));
}

export function clampHeight(height: number, maxHeight: number): number {
  if (!Number.isFinite(height)) return MIN_HEIGHT;
  return Math.max(
    MIN_HEIGHT,
    Math.min(height, Math.max(MIN_HEIGHT, maxHeight)),
  );
}

const [widthInternal, _internalSetWidth] = createSignal<number>(MIN_WIDTH);
const [heightInternal, _internalSetHeight] = createSignal<number>(MIN_HEIGHT);
const [openInternal, _internalSetOpen] = createSignal<boolean>(true);

export const detailPanelWidth = widthInternal;
export const detailPanelHeight = heightInternal;
export const detailPanelOpen = openInternal;

let hydrated = false;
let cachedPreferences: Preferences | undefined;

export async function hydrateDetailPanelLayout(): Promise<void> {
  if (hydrated) return;
  const prefs = await getPreferences();
  cachedPreferences = prefs;
  _internalSetWidth(prefs.layout.detailPanel.width);
  _internalSetHeight(prefs.layout.detailPanel.height);
  _internalSetOpen(prefs.layout.detailPanel.open);
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
  // Skip until hydration completes — otherwise a setter fired before
  // `hydrateDetailPanelLayout` resolves would round-trip an empty
  // envelope back to disk and clobber the user's saved sections.
  if (!cachedPreferences) return;
  const next: Preferences = {
    ...cachedPreferences,
    layout: {
      ...cachedPreferences.layout,
      detailPanel: {
        width: widthInternal(),
        height: heightInternal(),
        open: openInternal(),
      } satisfies DetailPanelLayout,
    },
  };
  cachedPreferences = await setPreferences(next);
}

/// Public setters. The `*Persist` flag controls whether the change
/// schedules a write — drag-in-progress mutations should pass false
/// and the drag-end handler flushes once via `commitDetailPanelLayout`.
export function setDetailPanelWidth(width: number, persist = true): void {
  _internalSetWidth(width);
  if (persist) schedulePersist();
}

export function setDetailPanelHeight(height: number, persist = true): void {
  _internalSetHeight(height);
  if (persist) schedulePersist();
}

export function setDetailPanelOpen(open: boolean): void {
  _internalSetOpen(open);
  schedulePersist();
}

export function toggleDetailPanelOpen(): void {
  setDetailPanelOpen(!openInternal());
}

/// Force a persist immediately (e.g. drag-end after a stream of
/// non-persisted updates). No-op when hydration hasn't finished.
export function commitDetailPanelLayout(): void {
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
  cachedPreferences = undefined;
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  _internalSetWidth(MIN_WIDTH);
  _internalSetHeight(MIN_HEIGHT);
  _internalSetOpen(true);
}

/// Eat a Solid effect dependency on `cachedPreferences` so external
/// reloads (e.g. preferences window reset) refresh signals to match
/// disk state without a full reload. Wires automatically when the
/// module is imported — same pattern `tabs/state.ts` uses for its
/// preferences-open auto-close.
createEffect(() => {
  // Touch the signal so re-imports during HMR re-establish the binding.
  void widthInternal();
  void heightInternal();
  void openInternal();
});
