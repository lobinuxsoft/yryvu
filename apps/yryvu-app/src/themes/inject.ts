// SPDX-License-Identifier: AGPL-3.0-or-later

//! Injection of an active theme's CSS into `<head>`.
//!
//! Two `<style>` elements are managed: `chaja-theme-tokens` for the
//! `:root[data-theme="<id>"] { ... }` block and `chaja-theme-personality`
//! for the optional decorative rules. Replacing their `textContent` (vs
//! recreating the elements) keeps CSS rule ordinals stable so transitions
//! remain smooth across theme switches.
//!
//! Tauri's default CSP allows inline `<style>` content; we still avoid
//! raw `style="..."` attributes which the CSP would block.

import type { ThemeCss } from "../ipc";

const TOKENS_ID = "chaja-theme-tokens";
const PERSONALITY_ID = "chaja-theme-personality";

function ensureStyleEl(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  return el;
}

/// Inject the theme's tokens + personality CSS into `<head>` and set
/// `<html data-theme="<id>">` so the scoped selectors match.
export function applyThemeCss(id: string, css: ThemeCss): void {
  document.documentElement.dataset.theme = id;
  ensureStyleEl(TOKENS_ID).textContent = css.tokens;
  ensureStyleEl(PERSONALITY_ID).textContent = css.personality;
}

/// Remove injected style tags. Used by tests to clean up between cases.
/// In production the injection is replaced, never removed.
export function clearInjectedTheme(): void {
  document.getElementById(TOKENS_ID)?.remove();
  document.getElementById(PERSONALITY_ID)?.remove();
  delete document.documentElement.dataset.theme;
}
