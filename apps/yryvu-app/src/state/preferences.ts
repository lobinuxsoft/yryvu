// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal } from "solid-js";

import {
  getPreferences,
  resetPreferences as ipcResetPreferences,
  setPreferences as ipcSetPreferences,
  type GeneralPreferences,
  type NotificationsPreferences,
  type Preferences,
  type ToolPreferences,
  type UiPreferences,
} from "../ipc";
import { persistedEnum } from "./storage";

// =============================================================================
// Preferences window (issue #136 — 1:1 port of GK's PreferenceView)
// =============================================================================

/// Section IDs accepted by chajá from GK's `tabTypes` enum. AGENTS / CLI /
/// GITKRAKEN_AI / ORGANIZATION / TEAM_SETTINGS are filtered out as
/// GK-proprietary per the coverage matrix in #136.
export const PREFERENCE_SECTION_IDS = [
  "general",
  "ui",
  "commit",
  "editor",
  "encoding",
  "conflict_detection",
  "experimental",
  "gpg",
  "gitflow",
  "githooks",
  "integrations",
  "issue_tracker",
  "lfs",
  "notifications",
  "profiles",
  "sparse_checkout",
  "ssh",
  "submodules",
  "tools",
] as const;

export type PreferenceSectionId = (typeof PREFERENCE_SECTION_IDS)[number];

export const [preferencesOpen, setPreferencesOpen] = createSignal(false);

export const [activePreferenceSection, setActivePreferenceSection] =
  persistedEnum<PreferenceSectionId>(
    "activePreferenceSection",
    "general",
    PREFERENCE_SECTION_IDS,
  );

export function openPreferences(section?: PreferenceSectionId): void {
  if (section) setActivePreferenceSection(section);
  setPreferencesOpen(true);
}

export function closePreferences(): void {
  setPreferencesOpen(false);
}

/// Backend-persisted preferences. Loaded once on app startup; subsequent
/// edits go through `updatePreferences` / `resetPreferences` which save
/// atomically backend-side and mutate this resource on success.
const [preferences, { mutate: mutatePreferencesResource }] =
  createResource<Preferences>(() => getPreferences());
export { preferences };

interface PreferencesPatch {
  general?: Partial<GeneralPreferences>;
  ui?: Partial<UiPreferences>;
  notifications?: Partial<NotificationsPreferences>;
  tools?: Partial<ToolPreferences>;
}

/// Apply a partial update to the persisted preferences. Merges per
/// section so the caller doesn't need to know about unrelated fields.
/// Throws if preferences haven't loaded yet — components should guard
/// with `preferences()` before offering a write surface.
export async function updatePreferences(patch: PreferencesPatch): Promise<void> {
  const current = preferences();
  if (!current) {
    throw new Error("preferences not loaded yet");
  }
  const next: Preferences = {
    ...current,
    general: { ...current.general, ...(patch.general ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) },
    notifications: {
      ...current.notifications,
      ...(patch.notifications ?? {}),
    },
    tools: { ...current.tools, ...(patch.tools ?? {}) },
  };
  const saved = await ipcSetPreferences(next);
  mutatePreferencesResource(saved);
}

/// Wipe persisted preferences and reload defaults. Used by the
/// Preferences window's "Reset to defaults" affordance.
export async function resetPreferences(): Promise<void> {
  const fresh = await ipcResetPreferences();
  mutatePreferencesResource(fresh);
}
