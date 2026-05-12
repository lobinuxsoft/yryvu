// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `yryvu_bridge::preferences::GeneralPreferences`. Empty for
/// now — extended by #102 (see #195 for why the previous toggle was rip'd).
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GeneralPreferences {}

/// Theme identifier — accepts any built-in id (`a-yryvu`,
/// `b-tokyo-night`, …, `k-default`), a custom theme id from
/// `<app-config>/themes/<id>/`, or the literal `"auto"` (which resolves
/// at runtime via `prefers-color-scheme`).
export type ThemeId = string;

/// Mirrors `yryvu_bridge::preferences::UiPreferences`. Theme lands here
/// in #292 sub-PR A; zoom (#293), density (#294), tooltips/animations
/// (#295) follow.
///
/// `zoom` is the global UI scale (`f32` on the wire). Ladder values
/// `[0.8, 0.9, 1.0, 1.1, 1.2, 1.3]` from GK's `ZOOM_FACTORS`
/// (`bundle:256353`); validation lives in the `<select>` UI, not the
/// loader. Default `1.0`.
export interface UiPreferences {
  theme: ThemeId;
  zoom: number;
}

/// Mirrors `yryvu_bridge::preferences::Tab`. Discriminated by `type`.
/// Wire format is camelCase per the backend's `serde(rename_all = "camelCase")`.
export type PersistedTab =
  | { type: "REPO"; id: string; repoPath: string; isWorktree: boolean }
  | { type: "NEW"; id: string }
  | { type: "RELEASE_NOTES"; id: string; version: string };

/// Mirrors `yryvu_bridge::preferences::PermanentTabState`.
export interface PermanentTabState {
  closed: boolean;
}

/// Mirrors `yryvu_bridge::preferences::PermanentTabs`. Currently only
/// REPO_MANAGEMENT (FOCUS_VIEW skipped — proprietary).
export interface PermanentTabs {
  repoManagement?: PermanentTabState;
}

/// Mirrors `yryvu_bridge::preferences::TabsPreferences`. Three fields
/// persist; `closedTabs` is in-memory only and lives in `tabs/state.ts`,
/// not in this envelope (matches GK at bundle:2373-2381).
export interface TabsPreferences {
  tabs: PersistedTab[];
  selectedTabId?: string;
  permanentTabs: PermanentTabs;
}

/// Mirrors `yryvu_bridge::preferences::CommitPreferences` (#304).
/// Backend persistence only — no panel reader yet. Shape exposed so a
/// future `Commit.tsx` consumer can type the IPC envelope without
/// another mirror bump. `commitTemplate` is the raw stored string
/// (summary + description joined with `\n\n` at apply-time).
export interface CommitPreferences {
  commitTemplate: string | null;
  useTemplateForCommitMessages: boolean;
  defaultPushAfterCommit: boolean;
  defaultSkipGitHooks: boolean;
  removeCommentsFromCommitMessages: boolean;
}

/// Mirrors `yryvu_bridge::preferences::ExternalTerminal` (#105). Path is
/// the absolute terminal binary; args is a shell-quoted argument
/// template with `{cwd}` substituted to the repo path at launch time.
/// Both nullable — `null`/empty path errors out at launch instead of
/// guessing a terminal across platforms.
export interface ExternalTerminal {
  path: string | null;
  args: string | null;
}

/// Mirrors `yryvu_bridge::preferences::ToolPreferences` (#105). Only
/// External Terminal is exposed by design; diff/merge/external editor
/// are out of scope (see #105 body for rationale).
export interface ToolPreferences {
  externalTerminal: ExternalTerminal;
}

/// Mirrors `yryvu_bridge::preferences::EolCharacter` (#190). Wire
/// format is kebab-case (`"lf"` / `"crlf"`) — drives the EOL
/// `<select>` value directly.
export type EolCharacter = "lf" | "crlf";

/// Mirrors `yryvu_bridge::preferences::EditorPreferences` (#190).
/// Backend persistence only — DiffView / FileDiffTab will consume the
/// settings (font, line numbers, syntax highlighting, EOL on write) in
/// a follow-up sub-PR. Whitespace display, multi-mode word wrap, and
/// EOL preserve are out of scope (not in GK bundle).
export interface EditorPreferences {
  font: string;
  showOnlyMonospace: boolean;
  fontSize: number;
  eolCharacter: EolCharacter;
  wordWrap: boolean;
  tabSize: number;
  showLineNumbers: boolean;
  syntaxHighlighting: boolean;
}

/// Mirrors `yryvu_bridge::preferences::Preferences`. The `version`
/// field is owned by the backend; never mutate it from the frontend.
export interface Preferences {
  version: number;
  general: GeneralPreferences;
  ui: UiPreferences;
  tabs: TabsPreferences;
  commit: CommitPreferences;
  tools: ToolPreferences;
  editor: EditorPreferences;
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

/// Spawn the configured external terminal at `repoPath`. Errors surface
/// to the caller as a rejected promise — the panel / toolbar binding
/// should toast the message (typically "external terminal path is not
/// configured" on first use, before the user picks one).
export function openExternalTerminal(repoPath: string): Promise<void> {
  return invoke<void>("open_external_terminal", { repoPath });
}
