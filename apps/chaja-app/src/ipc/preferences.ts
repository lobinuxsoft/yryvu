// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `chaja_bridge::preferences::GeneralPreferences`. Empty for
/// now — extended by #102 (see #195 for why the previous toggle was rip'd).
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GeneralPreferences {}

/// Theme identifier — accepts any built-in id (`a-default`,
/// `b-tokyo-night`, …, `j-kanagawa`), a custom theme id from
/// `<app-config>/themes/<id>/`, or the literal `"auto"` (which resolves
/// at runtime via `prefers-color-scheme`).
export type ThemeId = string;

/// Mirrors `chaja_bridge::preferences::UiPreferences`. Theme lands here
/// in #292 sub-PR A; zoom (#293), density (#294), tooltips/animations
/// (#295) follow.
export interface UiPreferences {
  theme: ThemeId;
}

/// Mirrors `chaja_bridge::preferences::Tab`. Discriminated by `type`.
/// Wire format is camelCase per the backend's `serde(rename_all = "camelCase")`.
export type PersistedTab =
  | { type: "REPO"; id: string; repoPath: string; isWorktree: boolean }
  | { type: "NEW"; id: string }
  | { type: "RELEASE_NOTES"; id: string; version: string };

/// Mirrors `chaja_bridge::preferences::PermanentTabState`.
export interface PermanentTabState {
  closed: boolean;
}

/// Mirrors `chaja_bridge::preferences::PermanentTabs`. Currently only
/// REPO_MANAGEMENT (FOCUS_VIEW skipped — proprietary).
export interface PermanentTabs {
  repoManagement?: PermanentTabState;
}

/// Mirrors `chaja_bridge::preferences::TabsPreferences`. Three fields
/// persist; `closedTabs` is in-memory only and lives in `tabs/state.ts`,
/// not in this envelope (matches GK at bundle:2373-2381).
export interface TabsPreferences {
  tabs: PersistedTab[];
  selectedTabId?: string;
  permanentTabs: PermanentTabs;
}

/// Mirrors `chaja_bridge::preferences::Preferences`. The `version`
/// field is owned by the backend; never mutate it from the frontend.
export interface Preferences {
  version: number;
  general: GeneralPreferences;
  ui: UiPreferences;
  tabs: TabsPreferences;
}

export function getPreferences(): Promise<Preferences> {
  return invoke<Preferences>("get_preferences");
}

export function setPreferences(preferences: Preferences): Promise<Preferences> {
  return invoke<Preferences>("set_preferences", { preferences });
}

export function resetPreferences(): Promise<Preferences> {
  return invoke<Preferences>("reset_preferences");
}
