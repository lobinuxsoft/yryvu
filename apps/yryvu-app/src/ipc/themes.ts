// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `chaja_bridge::themes::schema::Scheme`.
export type Scheme = "dark" | "light";

/// Mirrors `chaja_bridge::themes::schema::ThemeMetadata`. `id` MUST
/// match the containing folder name; the loader rejects mismatches.
export interface ThemeMetadata {
  name: string;
  id: string;
  scheme: Scheme;
  author?: string;
  version?: string;
}

/// Mirrors `chaja_bridge::themes::loader::ThemeEntry`. `builtIn=false`
/// means the theme lives under `<app-config>/themes/<id>/` and was
/// loaded from disk; `true` means it was embedded at compile time via
/// `include_dir!`.
export interface ThemeEntry extends ThemeMetadata {
  builtIn: boolean;
}

/// Mirrors `chaja_bridge::themes::loader::ThemeCss`. `personality` is
/// empty when the theme has no `personality.css`.
export interface ThemeCss {
  tokens: string;
  personality: string;
}

export function listThemes(): Promise<ThemeEntry[]> {
  return invoke<ThemeEntry[]>("list_themes");
}

export function getThemeCss(id: string): Promise<ThemeCss> {
  return invoke<ThemeCss>("get_theme_css", { id });
}

/// Copy a built-in theme to `<app-config>/themes/<unique-id>/`. Returns
/// the generated id (e.g. `a-default-copy`, `a-default-copy-2`, …).
export function createThemeFromTemplate(builtinId: string): Promise<string> {
  return invoke<string>("create_theme_from_template", { builtinId });
}

/// Open `<app-config>/themes/` in the OS file manager. Creates the
/// directory if it doesn't exist yet so the user lands somewhere valid.
export function openThemesFolder(): Promise<void> {
  return invoke<void>("open_themes_folder");
}
