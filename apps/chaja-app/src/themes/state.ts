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

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createEffect, createResource, createSignal, on, untrack } from "solid-js";

import { notify } from "../components/Notifications";
import { getThemeCss, listThemes, type ThemeEntry } from "../ipc";
import { preferences, updatePreferences } from "../state/preferences";
import {
  osColorScheme,
  resolveAutoTheme,
  subscribeColorScheme,
  type ColorSchemePreference,
} from "./auto-resolver";
import { applyThemeCss } from "./inject";

const FALLBACK_THEME_ID = "a-default";
const THEME_CHANGED_EVENT = "theme-changed";

const [colorScheme, setColorScheme] = createSignal<ColorSchemePreference>(
  osColorScheme(),
);
export { colorScheme };

const [themesResource, { refetch: refetchThemes }] =
  createResource<ThemeEntry[]>(() => listThemes(), { initialValue: [] });
export { themesResource as themes };
export { refetchThemes };

let osScopeUnsub: (() => void) | null = null;
let watcherUnsub: UnlistenFn | null = null;

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
/// changes so `"auto"` tracks the OS live without app reload, and to
/// the backend's `theme-changed` event for live-reload on filesystem
/// edits inside `<config>/themes/`.
export function mountThemeProvider(): void {
  if (osScopeUnsub) return;
  osScopeUnsub = subscribeColorScheme(setColorScheme);

  // Backend file-watcher events → refetch the theme list. The effect
  // below picks up the resource change and re-injects the active CSS.
  void listen(THEME_CHANGED_EVENT, () => {
    void refetchThemes();
  }).then((unlisten) => {
    watcherUnsub = unlisten;
  });

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

/// Eject the OS listener + watcher subscription — used by tests for
/// clean teardown. Production code calls [`mountThemeProvider`] once
/// and never unmounts.
export function unmountThemeProvider(): void {
  osScopeUnsub?.();
  osScopeUnsub = null;
  watcherUnsub?.();
  watcherUnsub = null;
}

async function injectById(id: string): Promise<void> {
  try {
    const css = await getThemeCss(id);
    untrack(() => applyThemeCss(id, css));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`theme '${id}' failed to load:`, msg);

    if (id === FALLBACK_THEME_ID) {
      // Fallback itself failed — the chrome's `:root` baseline (defined
      // in `styles/tokens.css` from commit 3a, mirroring a-default) keeps
      // the app legible. Surface the failure so the user knows.
      notify.error(`Theme '${id}' failed to load`, {
        message: `${msg}. Using built-in baseline.`,
      });
      return;
    }

    notify.error(`Theme '${id}' failed to load`, {
      message: `${msg}. Reverted to '${FALLBACK_THEME_ID}'.`,
    });

    // Revert the preference. The effect re-fires and calls injectById
    // for FALLBACK_THEME_ID — which has its own fail-safe above so we
    // can't loop indefinitely.
    try {
      await updatePreferences({ ui: { theme: FALLBACK_THEME_ID } });
    } catch (revertErr) {
      console.warn("failed to revert preferences to fallback theme:", revertErr);
    }
  }
}
