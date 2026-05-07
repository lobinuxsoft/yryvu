// SPDX-License-Identifier: AGPL-3.0-or-later

//! Resolve the literal `"auto"` theme to a concrete id based on
//! `prefers-color-scheme` + the available themes.
//!
//! Locked decisions (#292, session 2026-05-07):
//!   - `prefers-color-scheme: dark`  → `a-default` if available, else
//!     the first dark-scheme entry alphabetically by id.
//!   - `prefers-color-scheme: light` → `e-rose-pine-dawn` if available,
//!     else the first light-scheme entry alphabetically by id.
//!   - Hard-fail fallback (no themes loaded yet): return `"a-default"`
//!     so the chrome's `:root` baseline matches without theme injection.

import type { ThemeEntry } from "../ipc";

const PREFERRED_DARK = "a-default";
const PREFERRED_LIGHT = "e-rose-pine-dawn";
const MEDIA_QUERY_LIGHT = "(prefers-color-scheme: light)";

export type ColorSchemePreference = "dark" | "light";

/// Read the OS color-scheme preference. SSR-safe: falls back to `dark`
/// when `window.matchMedia` is absent.
export function osColorScheme(): ColorSchemePreference {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(MEDIA_QUERY_LIGHT).matches ? "light" : "dark";
}

/// Resolve `"auto"` to a concrete theme id given the available themes
/// and the OS preference. Picks the preferred id when present, otherwise
/// the first matching scheme entry alphabetically.
export function resolveAutoTheme(
  themes: readonly ThemeEntry[],
  scheme: ColorSchemePreference,
): string {
  const preferred = scheme === "light" ? PREFERRED_LIGHT : PREFERRED_DARK;
  if (themes.some((t) => t.id === preferred)) return preferred;

  const matching = themes
    .filter((t) => t.scheme === scheme)
    .map((t) => t.id)
    .sort();
  if (matching.length > 0) return matching[0];

  // No theme of the requested scheme — fall back to a-default if any
  // theme is loaded, otherwise the chrome-baseline literal id.
  return themes[0]?.id ?? PREFERRED_DARK;
}

/// Subscribe to OS color-scheme changes. Returns an unsubscribe function.
/// SSR-safe: no-op when `window.matchMedia` is absent.
export function subscribeColorScheme(
  callback: (scheme: ColorSchemePreference) => void,
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(MEDIA_QUERY_LIGHT);
  const onChange = (e: MediaQueryListEvent) => {
    callback(e.matches ? "light" : "dark");
  };
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
