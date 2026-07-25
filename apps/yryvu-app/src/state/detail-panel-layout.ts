// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Right-side inspector panel sizing + visibility (issue #134, PR1) and
 * the height of the commit region nested inside it (issue #151).
 * Mirrors GK's `layout.DetailPanel.{width, height, open}` per audit
 * doc `01-panel-chrome.md`, plus the commit region's own persisted
 * height — GK's `CommitDetailPanel` likewise lives inside the detail
 * panel and shares its envelope, so both ride one preferences cache
 * rather than a second one that could clobber this module's writes.
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

import { type DetailPanelLayout } from "../ipc/preferences";

import { mutatePreferences, preferencesReady } from "./preferences";

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

/// Floor of the commit region inside the WIP panel, GK verbatim for its
/// commit tab (bundle 269620). GK adds 25 px while Commit options is
/// expanded — the caller folds that into the `min` it asks for, which is
/// why the clamp takes one.
export const MIN_COMMIT_REGION_HEIGHT = 275;
export const COMMIT_OPTIONS_EXTRA_HEIGHT = 25;

/// Clamp the commit region against its floor and the space the staging
/// lists need above it. Unlike the panel clamps above, the floor is a
/// parameter: it moves with the Commit-options disclosure.
///
/// When the window is too short to honour `min` at all, the floor wins
/// over `maxHeight` — a commit button pushed off the bottom is worse
/// than a scrollbar, and the form's own scroller absorbs the overflow.
export function clampCommitRegionHeight(
  height: number,
  maxHeight: number,
  min: number = MIN_COMMIT_REGION_HEIGHT,
): number {
  if (!Number.isFinite(height)) return min;
  return Math.max(min, Math.min(height, Math.max(min, maxHeight)));
}

const [widthInternal, _internalSetWidth] = createSignal<number>(MIN_WIDTH);
const [heightInternal, _internalSetHeight] = createSignal<number>(MIN_HEIGHT);
const [openInternal, _internalSetOpen] = createSignal<boolean>(true);
const [commitRegionInternal, _internalSetCommitRegion] = createSignal<number>(
  MIN_COMMIT_REGION_HEIGHT,
);

export const detailPanelWidth = widthInternal;
export const detailPanelHeight = heightInternal;
export const detailPanelOpen = openInternal;
export const commitRegionHeight = commitRegionInternal;

let hydrated = false;

export async function hydrateDetailPanelLayout(): Promise<void> {
  if (hydrated) return;
  const prefs = await preferencesReady();
  _internalSetWidth(prefs.layout.detailPanel.width);
  _internalSetHeight(prefs.layout.detailPanel.height);
  _internalSetOpen(prefs.layout.detailPanel.open);
  _internalSetCommitRegion(prefs.layout.commitRegion.height);
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
  // `hydrateDetailPanelLayout` resolves would write this module's
  // defaults over what the user actually had saved.
  if (!hydrated) return;
  await mutatePreferences((current) => ({
    ...current,
    layout: {
      ...current.layout,
      detailPanel: {
        width: widthInternal(),
        height: heightInternal(),
        open: openInternal(),
      } satisfies DetailPanelLayout,
      commitRegion: { height: Math.round(commitRegionInternal()) },
    },
  }));
}

/// Public setters. The `*Persist` flag controls whether the change
/// schedules a write — drag-in-progress mutations should pass false
/// and the drag-end handler flushes once via `commitDetailPanelLayout`.
export function setDetailPanelWidth(width: number, persist = true): void {
  _internalSetWidth(width);
  if (persist) schedulePersist();
}

/// Height of the commit region inside the WIP panel. Same drag cadence
/// as the panel dimensions: `persist=false` per pointermove, one flush
/// via `commitDetailPanelLayout` on pointerup.
export function setCommitRegionHeight(height: number, persist = true): void {
  _internalSetCommitRegion(height);
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

/// Eat a Solid effect dependency on the signals so external
/// reloads (e.g. preferences window reset) refresh signals to match
/// disk state without a full reload. Wires automatically when the
/// module is imported — same pattern `tabs/state.ts` uses for its
/// preferences-open auto-close.
createEffect(() => {
  // Touch the signal so re-imports during HMR re-establish the binding.
  void widthInternal();
  void heightInternal();
  void openInternal();
  void commitRegionInternal();
});
