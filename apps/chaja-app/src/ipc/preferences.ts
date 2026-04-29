// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `chaja_bridge::preferences::GeneralPreferences`. Each field
/// matches its Rust counterpart 1:1; serde rewrites snake_case to
/// camelCase on the wire.
export interface GeneralPreferences {
  confirmDestructiveOps: boolean;
}

/// Mirrors `chaja_bridge::preferences::UiPreferences`. Empty for now —
/// extended by #103.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface UiPreferences {}

/// Mirrors `chaja_bridge::preferences::Preferences`. The `version`
/// field is owned by the backend; never mutate it from the frontend.
export interface Preferences {
  version: number;
  general: GeneralPreferences;
  ui: UiPreferences;
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
