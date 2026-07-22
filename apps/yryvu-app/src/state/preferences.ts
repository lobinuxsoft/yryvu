// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal } from "solid-js";

import {
  getPreferences,
  resetPreferences as ipcResetPreferences,
  setPreferences as ipcSetPreferences,
  type CommitPreferences,
  type EditorPreferences,
  type GeneralPreferences,
  type GpgPreferences,
  type IssueTrackerPreferences,
  type NotificationsPreferences,
  type Preferences,
  type SshPreferences,
  type SubmodulesPreferences,
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

/// Backend-persisted preferences — the **single** in-memory copy of the
/// envelope. Every writer goes through `mutatePreferences` below.
///
/// It has to be single. `setPreferences` takes the whole envelope, so a
/// module that keeps its own copy and writes from it reverts every field
/// another module changed after that copy was taken. The panel-layout,
/// sidebar-layout and tab modules each used to hold one, which meant
/// resizing the sidebar and then the inspector silently restored the
/// sidebar's boot-time width.
///
/// `loadOnce` is declared *above* the resource on purpose: `createResource`
/// invokes its fetcher during construction, so a `let` declared after this
/// line is still in its temporal dead zone when the fetcher runs and the
/// module throws on import.
let loadPromise: Promise<Preferences> | undefined;

/// The boot load, shared by every caller so N hydrators cost one IPC.
function loadOnce(): Promise<Preferences> {
  // A rejected load is not memoized: keeping it would leave every later
  // hydrator and write permanently broken over one transient IPC failure.
  loadPromise ??= getPreferences().catch((err: unknown) => {
    loadPromise = undefined;
    throw err;
  });
  return loadPromise;
}

const [preferences, { mutate: mutatePreferencesResource }] =
  createResource<Preferences>(loadOnce);
export { preferences };

/// Resolves with the envelope once it's available. Hydration paths that
/// run before any component reads the resource use this instead of
/// calling `getPreferences` again.
export async function preferencesReady(): Promise<Preferences> {
  return preferences() ?? (await loadOnce());
}

/// Serialises writes. Each mutator reads the envelope *after* the
/// previous write has landed, so concurrent callers compose instead of
/// overwriting each other — a debounced layout persist firing while a
/// preferences-window save is in flight is the ordinary case, not an
/// edge one.
let writeChain: Promise<unknown> = Promise.resolve();

/// Apply a change to the persisted envelope and publish the result.
/// `apply` must be pure: it may run after an await and must not assume
/// anything it read beforehand is still current.
export async function mutatePreferences(
  apply: (current: Preferences) => Preferences,
): Promise<void> {
  const run = async (): Promise<void> => {
    const current = await preferencesReady();
    const saved = await ipcSetPreferences(apply(current));
    mutatePreferencesResource(saved);
  };
  // Chained on both settlement paths: one failed write must not wedge
  // the queue for everything behind it.
  writeChain = writeChain.then(run, run);
  await writeChain;
}

interface PreferencesPatch {
  general?: Partial<GeneralPreferences>;
  ui?: Partial<UiPreferences>;
  notifications?: Partial<NotificationsPreferences>;
  tools?: Partial<ToolPreferences>;
  commit?: Partial<CommitPreferences>;
  editor?: Partial<EditorPreferences>;
  issueTracker?: Partial<IssueTrackerPreferences>;
  gpg?: Partial<GpgPreferences>;
  ssh?: Partial<SshPreferences>;
  submodules?: Partial<SubmodulesPreferences>;
}

/// Apply a partial update to the persisted preferences. Merges per
/// section so the caller doesn't need to know about unrelated fields.
/// Throws if preferences haven't loaded yet — components should guard
/// with `preferences()` before offering a write surface.
export async function updatePreferences(patch: PreferencesPatch): Promise<void> {
  if (!preferences()) {
    throw new Error("preferences not loaded yet");
  }
  return mutatePreferences((current) => ({
    ...current,
    general: { ...current.general, ...(patch.general ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) },
    notifications: {
      ...current.notifications,
      ...(patch.notifications ?? {}),
    },
    tools: { ...current.tools, ...(patch.tools ?? {}) },
    commit: { ...current.commit, ...(patch.commit ?? {}) },
    editor: { ...current.editor, ...(patch.editor ?? {}) },
    issueTracker: {
      ...current.issueTracker,
      ...(patch.issueTracker ?? {}),
    },
    gpg: { ...current.gpg, ...(patch.gpg ?? {}) },
    ssh: { ...current.ssh, ...(patch.ssh ?? {}) },
    submodules: { ...current.submodules, ...(patch.submodules ?? {}) },
  }));
}

/// Wipe persisted preferences and reload defaults. Used by the
/// Preferences window's "Reset to defaults" affordance. Queued behind
/// pending writes so a debounced layout persist can't land on top of the
/// defaults and resurrect one section of the old file.
export async function resetPreferences(): Promise<void> {
  const run = async (): Promise<void> => {
    const fresh = await ipcResetPreferences();
    loadPromise = Promise.resolve(fresh);
    mutatePreferencesResource(fresh);
  };
  writeChain = writeChain.then(run, run);
  await writeChain;
}
