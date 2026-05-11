// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

/// Pending ref-click navigation request. The CommitGraph effect resolves
/// `sha` against the current row list, scrolls if needed, and selects the
/// commit. The `seq` field bumps on every call so two clicks on the same
/// ref re-fire the effect (the request value otherwise wouldn't change,
/// and Solid signal updates skip duplicates by reference equality).
export interface RefNavRequest {
  sha: string;
  seq: number;
}

const [pendingRefNavInternal, setPendingRefNavInternal] = createSignal<
  RefNavRequest | undefined
>(undefined);

export const pendingRefNav = pendingRefNavInternal;

let seq = 0;

/// Issue a ref-click navigation. Call from sidebar branch / tag rows on
/// plain click. The CommitGraph effect picks it up, scrolls (center
/// alignment when off-screen, no-op when already visible) and selects.
export function navigateToRef(sha: string): void {
  if (!sha) return;
  seq += 1;
  setPendingRefNavInternal({ sha, seq });
}

/// Clear the pending request — called by the CommitGraph effect after it
/// has serviced (or rejected) the navigation.
export function clearPendingRefNav(): void {
  setPendingRefNavInternal(undefined);
}
