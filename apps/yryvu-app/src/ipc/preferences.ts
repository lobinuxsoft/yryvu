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

/// Animation policy mirror of `yryvu_bridge::preferences::AnimationMode`.
/// `system` honors the OS-level `prefers-reduced-motion` query at
/// runtime; `always` and `never` are explicit overrides. Wire format
/// matches the backend's camelCase serde.
export type AnimationMode = "always" | "system" | "never";

/// Mirrors `yryvu_bridge::preferences::UiPreferences`. Theme lands here
/// in #292 sub-PR A; zoom (#293), density (#294), tooltips/animations
/// (#315 backend, #316 view) follow.
///
/// `zoom` is the global UI scale (`f32` on the wire). Ladder values
/// `[0.8, 0.9, 1.0, 1.1, 1.2, 1.3]` from GK's `ZOOM_FACTORS`
/// (`bundle:256353`); validation lives in the `<select>` UI, not the
/// loader. Default `1.0`.
///
/// `tooltipsEnabled` toggles the `<Tooltip>` component visually
/// (aria-label survives for screen readers); `tooltipDelayMs` is the
/// hover delay in milliseconds before the bubble appears (range
/// 0–2000ms in the panel, `u16` on the wire).
export interface UiPreferences {
  theme: ThemeId;
  zoom: number;
  tooltipsEnabled: boolean;
  tooltipDelayMs: number;
  animations: AnimationMode;
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

/// Mirrors `yryvu_bridge::preferences::EditorPreferences` (#190,
/// trimmed by #344). DiffView / FileDiffTab will consume the surviving
/// settings (line numbers, syntax highlighting, EOL on write, tab size,
/// word wrap) in a follow-up. Font and font-size were dropped because
/// UI themes already define `--font-mono` and `UiPreferences.zoom`
/// scales globally. Whitespace display, multi-mode word wrap, and EOL
/// preserve are out of scope (not in GK bundle).
export interface EditorPreferences {
  eolCharacter: EolCharacter;
  wordWrap: boolean;
  tabSize: number;
  showLineNumbers: boolean;
  syntaxHighlighting: boolean;
}

/// Mirrors `yryvu_bridge::preferences::GpgPreferences` (#104, subset).
/// `signingKeyId` is a free-form fingerprint or email Git resolves via
/// its own `user.signingkey` rules; `null` means "use Git's own
/// resolution". The original issue body also called for key-list
/// enumeration (`gpg --list-secret-keys`), passphrase caching, and a
/// test-sign button — those require shelling out to `gpg` and a
/// per-profile model (blocked by #22), so they stay out of scope.
export interface GpgPreferences {
  signingKeyId: string | null;
  signCommitsByDefault: boolean;
  signTagsByDefault: boolean;
  sshSigningEnabled: boolean;
}

/// Mirrors `yryvu_bridge::preferences::SshPreferences` (#47). Host →
/// absolute private key path written by the SSH key generation wizard.
export interface SshPreferences {
  keyPaths: Record<string, string>;
}

/// Mirrors `yryvu_bridge::preferences::IssueTrackerPreferences` (#306).
/// Holds the global default pattern + linkify / auto-detect toggles.
/// Per-repo overrides live in the repo's own `.git/config` under
/// `[yryvu] issueTrackerUrl` and travel via separate commands in
/// `ipc/issue_tracker.ts` rather than this struct.
export interface IssueTrackerPreferences {
  defaultUrlPattern: string | null;
  linkifyInCommits: boolean;
  autoDetectProvider: boolean;
}

/// Mirrors `yryvu_bridge::preferences::NotificationsPreferences`
/// (#193). yryvu deviation from GK — GK exposes only Desktop +
/// Marketing toggles which don't map here. Six per-category bools
/// derived from the `notify.*` callsite audit; the wave-2 consumer
/// reads these before emitting from the `notify.*` API.
export interface NotificationsPreferences {
  remoteSyncNotifications: boolean;
  branchNotifications: boolean;
  commitNotifications: boolean;
  stashNotifications: boolean;
  repoObjectNotifications: boolean;
  undoRedoNotifications: boolean;
}

/// Mirrors `yryvu_bridge::preferences::DetailPanelLayout`. Width/height
/// in CSS pixels. GK defaults verbatim: 400×386, open=true (audit doc
/// `01-panel-chrome.md`).
export interface DetailPanelLayout {
  width: number;
  height: number;
  open: boolean;
}

/// Mirrors `yryvu_bridge::preferences::LeftSidebarLayout`. Width in
/// CSS pixels. Default 215 per audit doc
/// `gitkraken-left-panel/00-overview.md`. GK persists this under the
/// legacy `RefPanel` key; Yryvu uses the descriptive `leftSidebar`
/// name on the wire.
export interface LeftSidebarLayout {
  width: number;
  open: boolean;
}

/// Mirrors `yryvu_bridge::preferences::LayoutPreferences`. Envelope for
/// resizable-panel state — currently the right-side inspector and the
/// left sidebar.
export interface LayoutPreferences {
  detailPanel: DetailPanelLayout;
  leftSidebar: LeftSidebarLayout;
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
  notifications: NotificationsPreferences;
  issueTracker: IssueTrackerPreferences;
  gpg: GpgPreferences;
  ssh: SshPreferences;
  layout: LayoutPreferences;
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
