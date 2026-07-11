// SPDX-License-Identifier: AGPL-3.0-or-later

//! Injection of an active theme's CSS into `<head>`.
//!
//! Three `<style>` elements are managed, one per layer:
//! `yryvu-theme-tokens` (the `:root[data-theme="<id>"] { ... }` variables),
//! `yryvu-theme-icons` (per-icon `--icon-*` mask sources), and
//! `yryvu-theme-personality` (decorative rules). They are appended in that
//! order so personality cascades over tokens/icons. Replacing their
//! `textContent` (vs recreating the elements) keeps CSS rule ordinals
//! stable so transitions remain smooth across theme switches.
//!
//! Tauri's default CSP allows inline `<style>` content; we still avoid
//! raw `style="..."` attributes which the CSP would block.

import type { ThemeCss } from "../ipc";

const TOKENS_ID = "yryvu-theme-tokens";
const ICONS_ID = "yryvu-theme-icons";
const PERSONALITY_ID = "yryvu-theme-personality";

function ensureStyleEl(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  return el;
}

/// Inject the theme's tokens + icons + personality CSS into `<head>` and
/// set `<html data-theme="<id>">` so the scoped selectors match. Order of
/// first-run appends fixes cascade order: tokens, then icons, then
/// personality.
export function applyThemeCss(id: string, css: ThemeCss): void {
  document.documentElement.dataset.theme = id;
  ensureStyleEl(TOKENS_ID).textContent = css.tokens;
  ensureStyleEl(ICONS_ID).textContent = css.icons;
  ensureStyleEl(PERSONALITY_ID).textContent = css.personality;
}

/// Remove injected style tags. Used by tests to clean up between cases.
/// In production the injection is replaced, never removed.
export function clearInjectedTheme(): void {
  document.getElementById(TOKENS_ID)?.remove();
  document.getElementById(ICONS_ID)?.remove();
  document.getElementById(PERSONALITY_ID)?.remove();
  delete document.documentElement.dataset.theme;
}
