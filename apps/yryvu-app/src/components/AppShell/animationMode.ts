// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, onCleanup } from "solid-js";

import type { AnimationMode } from "../../ipc";
import { preferences } from "../../state/preferences";

/// Resolve the effective animation policy from
/// `preferences().ui.animations` and apply it to the
/// `<html data-animations>` attribute. The CSS rule keyed off this
/// attribute disables transitions / animations app-wide while leaving
/// the loading spinner alone (high-specificity exemption in
/// `loading-spinner.css`).
///
/// `system` subscribes to `prefers-reduced-motion: reduce` live so OS
/// preference toggles flip the attribute without an app restart.
/// `always` / `never` are explicit overrides.
///
/// Call once from `AppShell.onMount` — the effect + media listener
/// stay alive for the lifetime of the app's reactive owner.
export function wireAnimationMode(): void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let prefersReduced = media.matches;
  const onMediaChange = (e: MediaQueryListEvent) => {
    prefersReduced = e.matches;
    apply();
  };
  media.addEventListener("change", onMediaChange);
  onCleanup(() => media.removeEventListener("change", onMediaChange));

  const resolve = (mode: AnimationMode | undefined): "always" | "never" => {
    if (mode === "always") return "always";
    if (mode === "never") return "never";
    // "system" (default) honors the OS preference.
    return prefersReduced ? "never" : "always";
  };

  const apply = () => {
    const mode = preferences()?.ui.animations;
    document.documentElement.dataset.animations = resolve(mode);
  };

  createEffect(apply);
}
