// SPDX-License-Identifier: AGPL-3.0-or-later

//! Global UI zoom (issue #293/#313). Reproduces GK's `webFrame.setZoomFactor`
//! behavior with CSS `zoom` on `:root` (Option B in
//! `docs/research/gitkraken-ui-preferences/05-zoom.md`) — every surface
//! scales uniformly without a `px → rem` codemod.
//!
//! The Solid signal driving the visual is `preferences().ui.zoom`. Both
//! the Preferences panel `<select>` (wave 2 follow-up) and the status-bar
//! mirror (#313) write through `updatePreferences({ ui: { zoom } })` —
//! single source of truth, both surfaces stay in sync automatically.

import { createEffect, on } from "solid-js";

import { preferences } from "./state/preferences";

/// Ladder shipped by GK Desktop 12.1.1 in the status-bar zoom dropdown
/// (user-verified against the live UI; the bundle dump's
/// `ZOOM_FACTORS = [1.3, 1.2, 1.1, 1.0, 0.9, 0.8]` is an older slice
/// — current GK extends to 200% for accessibility). Stored ascending;
/// the `<select>` reverses for display so 200% sits at the top.
export const ZOOM_FACTORS = [
  0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0,
] as const;

export const DEFAULT_ZOOM = 1.0;

let mounted = false;

/// Mount the reactive effect that applies `preferences().ui.zoom` to
/// `:root` via CSS `zoom`. Idempotent — calling twice is a no-op past
/// the first invocation. Safe to call before `preferences()` resolves;
/// the effect re-fires on first hydration.
export function mountZoomProvider(): void {
  if (mounted) return;
  mounted = true;

  createEffect(
    on(preferences, (prefs) => {
      const z = prefs?.ui.zoom ?? DEFAULT_ZOOM;
      // Setting via inline style on `<html>` rather than a stylesheet
      // rule keeps the mutation cheap and avoids a CSSOM round-trip.
      document.documentElement.style.zoom = String(z);
    }),
  );
}
