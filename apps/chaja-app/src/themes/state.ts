// SPDX-License-Identifier: AGPL-3.0-or-later

//! SolidJS reactive layer for the theme system.
//!
//! Owns the cached list of available themes (built-in + custom) and the
//! effect that watches `preferences().ui.theme`, runs the auto-resolver
//! when the literal `"auto"` is active, fetches the resolved theme's
//! CSS via the backend, and injects it into `<head>`.
//!
//! Mounted once at app boot via [`mountThemeProvider`]. The chrome's
//! `:root` baseline (a-default tokens) keeps the first paint legible
//! before this resolves; the injection then takes over in the next
//! microtask.

import { createEffect, createResource, createSignal, on, untrack } from "solid-js";

import { getThemeCss, listThemes, type ThemeEntry } from "../ipc";
import { preferences } from "../state/preferences";
import {
  osColorScheme,
  resolveAutoTheme,
  subscribeColorScheme,
  type ColorSchemePreference,
} from "./auto-resolver";
import { applyThemeCss } from "./inject";

const [colorScheme, setColorScheme] = createSignal<ColorSchemePreference>(
  osColorScheme(),
);
export { colorScheme };

const [themesResource, { refetch: refetchThemes }] =
  createResource<ThemeEntry[]>(() => listThemes(), { initialValue: [] });
export { themesResource as themes };
export { refetchThemes };

let osScopeUnsub: (() => void) | null = null;

/// Compute the concrete id that should be active given the current
/// preference and theme list. `"auto"` resolves; anything else passes
/// through as long as the id exists in the list (otherwise the loader
/// will surface NotFound when fetched).
export function resolveActiveThemeId(
  preferred: string,
  list: readonly ThemeEntry[],
  scheme: ColorSchemePreference,
): string {
  if (preferred === "auto") return resolveAutoTheme(list, scheme);
  return preferred;
}

/// Mount the theme injection effect. Idempotent — calling twice is a
/// no-op past the first invocation. Also subscribes to OS color-scheme
/// changes so `"auto"` tracks the OS live without app reload.
export function mountThemeProvider(): void {
  if (osScopeUnsub) return;
  osScopeUnsub = subscribeColorScheme(setColorScheme);

  // Effect: re-inject whenever the active id changes. `on()` makes the
  // dependency tracking explicit so we don't subscribe to ThemeCss
  // contents (which would cause infinite churn on the resource).
  createEffect(
    on(
      [preferences, themesResource, colorScheme],
      ([prefs, list, scheme]) => {
        if (!prefs) return;
        const id = resolveActiveThemeId(prefs.ui.theme, list, scheme);
        void injectById(id);
      },
    ),
  );
}

/// Eject the OS listener — used by tests for clean teardown. Production
/// code calls [`mountThemeProvider`] once and never unmounts.
export function unmountThemeProvider(): void {
  osScopeUnsub?.();
  osScopeUnsub = null;
}

async function injectById(id: string): Promise<void> {
  try {
    const css = await getThemeCss(id);
    untrack(() => applyThemeCss(id, css));
  } catch (err) {
    console.warn(`theme '${id}' failed to load:`, err);
    // Self-healing falls under commit 4 (#292). For now we leave the
    // previously injected theme in place so the chrome stays styled.
  }
}
