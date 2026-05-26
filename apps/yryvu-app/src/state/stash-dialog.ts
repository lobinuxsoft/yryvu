// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Open/close signal for the StashCreateDialog (issue #12). Decoupled
 * from the dialog component so any caller (toolbar Stash button,
 * command palette, sidebar header action) can flip it.
 */

import { createSignal } from "solid-js";

export const [stashDialogOpen, setStashDialogOpen] = createSignal(false);

export function openStashDialog(): void {
  setStashDialogOpen(true);
}

export function closeStashDialog(): void {
  setStashDialogOpen(false);
}
