// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource, createSignal, type Signal } from "solid-js";

import { getWorkingTreeStatus, type WorkingTreeStatus } from "./ipc";
import {
  clampZoneWidth,
  presetVisibility,
  presetWidths,
  ZONE_ORDER,
  type GraphColumnMode,
  type GraphZoneId,
} from "./components/CommitGraph/columns";

const STORAGE_PREFIX = "chaja.";
const STORAGE_RECENT_KEY = `${STORAGE_PREFIX}recentRepos`;

function persistedBool(key: string, fallback: boolean): Signal<boolean> {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  const initial = stored === null ? fallback : stored === "1";
  const [value, setValue] = createSignal(initial);
  const wrapped: Signal<boolean>[1] = ((next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(value()) : next;
    localStorage.setItem(STORAGE_PREFIX + key, resolved ? "1" : "0");
    return setValue(resolved);
  }) as Signal<boolean>[1];
  return [value, wrapped];
}

export const [showLeftPanel, setShowLeftPanel] = persistedBool("showLeftPanel", true);
export const [showRightPanel, setShowRightPanel] = persistedBool("showRightPanel", true);
export const [showTerminalPanel, setShowTerminalPanel] = persistedBool("showTerminalPanel", false);

/// Collapse state for the Unstaged / Staged sections in the commit panel.
/// Persisted globally (not per-repo) — GK persists per-repo but the extra
/// bookkeeping is overkill until users ask for it.
export const [unstagedFilesCollapsed, setUnstagedFilesCollapsed] =
  persistedBool("unstagedFilesCollapsed", false);
export const [stagedFilesCollapsed, setStagedFilesCollapsed] = persistedBool(
  "stagedFilesCollapsed",
  false,
);

/// `Commit Options` collapsible (skip hooks / GPG sign) below the message
/// box. Matches GK's `getPendingCommitOptionsExpanded`.
export const [pendingCommitOptionsExpanded, setPendingCommitOptionsExpanded] =
  persistedBool("pendingCommitOptionsExpanded", false);

/// Bypass pre-commit hooks. No-op on the git2 backend (libgit2 never
/// invokes hooks) but wired through for frontend/backend parity and so
/// future-gix migration picks up the flag for free.
export const [skipHooksEnabled, setSkipHooksEnabled] = persistedBool(
  "skipHooksEnabled",
  false,
);

export type Theme = "dark" | "light";

function persistedTheme(): Signal<Theme> {
  const stored = localStorage.getItem(STORAGE_PREFIX + "theme");
  const initial: Theme = stored === "light" ? "light" : "dark";
  const [value, setValue] = createSignal<Theme>(initial);
  const wrapped: Signal<Theme>[1] = ((next: Theme | ((prev: Theme) => Theme)) => {
    const resolved = typeof next === "function" ? next(value()) : next;
    localStorage.setItem(STORAGE_PREFIX + "theme", resolved);
    return setValue(resolved);
  }) as Signal<Theme>[1];
  return [value, wrapped];
}

export const [theme, setTheme] = persistedTheme();

const [repoPath, setRepoPathRaw] = createSignal<string | undefined>(undefined);
export { repoPath };

/// Swap the active repository. Clears every per-repo ephemeral signal
/// (selection, hovered ref, inspector mode, draft commit message,
/// amend, …) so stale state from the previous repo doesn't leak — the
/// classic repro was clicking commits after a switch and nothing
/// responding because `selectedCommit` still pointed at a SHA that
/// didn't exist in the new repo, which in turn pinned the WIP
/// calculations and inspector resources on ghost data.
///
/// Must live near the bottom of the signal declarations because it
/// writes into several setters declared below. Exported as a function so
/// call sites stay stable.
export function setRepoPath(next: string | undefined): void {
  const prev = repoPath();
  setRepoPathRaw(next);
  if (prev === next) return;
  setSelectedCommit(undefined);
  setSelectedDiffFile(undefined);
  setHoveredRef(undefined);
  setPinnedSha(undefined);
  setInspectorMode("details");
  setCommitMessage("");
  setCommitDescription("");
  setAmendEnabled(false);
}
export const [selectedCommit, setSelectedCommit] = createSignal<string | undefined>(undefined);

export type MainView = "graph" | "diff";
export const [mainView, setMainView] = createSignal<MainView>("graph");

export type SelectedDiffFile =
  | { kind: "commit"; sha: string; path: string }
  | { kind: "staging"; side: "unstaged" | "staged"; path: string };

export const [selectedDiffFile, setSelectedDiffFile] = createSignal<
  SelectedDiffFile | undefined
>(undefined);

export function openDiffTab(sha: string, path: string) {
  setSelectedDiffFile({ kind: "commit", sha, path });
  setMainView("diff");
}

export function openStagingDiffTab(
  side: "unstaged" | "staged",
  path: string
) {
  setSelectedDiffFile({ kind: "staging", side, path });
  setMainView("diff");
}

export function closeDiffTab() {
  setSelectedDiffFile(undefined);
  setMainView("graph");
}

/// Inspector mode — "details" shows the selected commit; "staging" shows the
/// Unstaged/Staged file lists. Toggled by the WIP banner's View Changes button.
export type InspectorMode = "details" | "staging";
export const [inspectorMode, setInspectorMode] =
  createSignal<InspectorMode>("details");

/// Bumped whenever a staging-mutating op completes, so resources watching
/// working-tree status re-fetch.
export const [workingTreeNonce, setWorkingTreeNonce] = createSignal(0);
export function refreshWorkingTree() {
  setWorkingTreeNonce((n) => n + 1);
}

export const [workingTreeStatus] = createResource<
  WorkingTreeStatus | undefined,
  [string, number]
>(
  () => {
    const p = repoPath();
    return p ? ([p, workingTreeNonce()] as [string, number]) : undefined;
  },
  async ([p]) => await getWorkingTreeStatus(p)
);

/// Draft commit message — two-way bound between the WIP row's input and the
/// inspector commit panel.
export const [commitMessage, setCommitMessage] = createSignal("");
export const [commitDescription, setCommitDescription] = createSignal("");
export const [amendEnabled, setAmendEnabled] = createSignal(false);

/// Bumped after any commit-creating op so CommitGraph re-streams.
export const [graphNonce, setGraphNonce] = createSignal(0);
export function refreshGraph() {
  setGraphNonce((n) => n + 1);
}

/// Bumped after any ref-mutating op (branch create/rename/delete, tag
/// create, …) so the sidebar branch list and repo-state banner re-fetch.
export const [branchesNonce, setBranchesNonce] = createSignal(0);
export function refreshBranches() {
  setBranchesNonce((n) => n + 1);
}

/// The ref the cursor is hovering (either a pill in the graph's BRANCH/TAG
/// column or a row in the sidebar). Drives the graph's hover-dim effect
/// (#54) — commits that aren't ancestors of the hovered ref fade to a low
/// opacity, so the user can see at a glance which commits "belong to"
/// that branch/tag.
///
/// Matches GitKraken's `isMissingHoveredRefGroup` selector (doc 08 / bundle
/// `Gd` row wrapper): the membership test uses the row's own refs first,
/// then falls back to the pre-computed `child_refs` propagated bottom-up
/// by `graph-core::populate_child_refs`.
export type HoveredRefKind = "head" | "remote" | "tag";
export interface HoveredRef {
  kind: HoveredRefKind;
  name: string;
}
export const [hoveredRef, setHoveredRef] = createSignal<HoveredRef | undefined>(
  undefined,
);
export function clearHoveredRef() {
  setHoveredRef(undefined);
}

/// SHA of the trunk pin chosen by the backend's `pick_pinned_head`. Written
/// once per repo by the graph stream's `onPinned` callback; consumed by the
/// ref-pill ordering pass to surface the pinned-branch annotation (doc 06
/// stage 2). `undefined` until the first stream batch arrives, or for repos
/// with no resolvable trunk (detached HEAD + no remote default).
export const [pinnedSha, setPinnedSha] = createSignal<string | undefined>(
  undefined,
);

/// Refs the user has hidden from the graph via the ref-pill context menu.
/// Keyed by `<kind>/<name>` so tags and branches with colliding names stay
/// distinct (matches the GK bundle's per-(kind,name) tracking). Persisted
/// globally — GK persists per-repo but until profile-level prefs land the
/// extra bookkeeping is overkill, and the cost of carrying a stale entry
/// across repo switches is just an empty filter pass.
const HIDDEN_REFS_KEY = `${STORAGE_PREFIX}hiddenRefs`;

function loadHiddenRefs(): Set<string> {
  const raw = localStorage.getItem(HIDDEN_REFS_KEY);
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set<string>(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set<string>();
  }
}

const [hiddenRefsInternal, setHiddenRefsInternal] =
  createSignal<Set<string>>(loadHiddenRefs());

export const hiddenRefs = hiddenRefsInternal;

function persistHiddenRefs(next: Set<string>): void {
  localStorage.setItem(HIDDEN_REFS_KEY, JSON.stringify(Array.from(next)));
}

export function setHiddenRef(key: string, hidden: boolean): void {
  const next = new Set(hiddenRefsInternal());
  if (hidden) next.add(key);
  else next.delete(key);
  persistHiddenRefs(next);
  setHiddenRefsInternal(next);
}

export function clearHiddenRefs(): void {
  const empty = new Set<string>();
  persistHiddenRefs(empty);
  setHiddenRefsInternal(empty);
}

/// Graph column system — widths, visibility, mode (default vs compact),
/// Smart Branch Visibility toggle. Persisted globally; per-repo overrides
/// can layer on top in a future pass (matches GK's two-tier persistence
/// model from research doc 10).
const COLUMN_WIDTHS_KEY = `${STORAGE_PREFIX}graphColumnWidths`;
const COLUMN_VISIBILITY_KEY = `${STORAGE_PREFIX}graphColumnVisibility`;

function loadColumnWidths(): Record<GraphZoneId, number> {
  const raw = localStorage.getItem(COLUMN_WIDTHS_KEY);
  const fallback = presetWidths("default");
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const out = { ...fallback };
    for (const id of ZONE_ORDER) {
      const candidate = (parsed as Record<string, unknown>)[id];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        out[id] = clampZoneWidth(id, candidate);
      }
    }
    return out;
  } catch {
    return fallback;
  }
}

function loadColumnVisibility(): Record<GraphZoneId, boolean> {
  const raw = localStorage.getItem(COLUMN_VISIBILITY_KEY);
  const fallback = presetVisibility();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const out = { ...fallback };
    for (const id of ZONE_ORDER) {
      const candidate = (parsed as Record<string, unknown>)[id];
      if (typeof candidate === "boolean") out[id] = candidate;
    }
    return out;
  } catch {
    return fallback;
  }
}

const [graphColumnWidthsInternal, setGraphColumnWidthsInternal] =
  createSignal<Record<GraphZoneId, number>>(loadColumnWidths());
const [graphColumnVisibilityInternal, setGraphColumnVisibilityInternal] =
  createSignal<Record<GraphZoneId, boolean>>(loadColumnVisibility());

export const graphColumnWidths = graphColumnWidthsInternal;
export const graphColumnVisibility = graphColumnVisibilityInternal;

export function setGraphZoneWidth(id: GraphZoneId, width: number): void {
  const next = { ...graphColumnWidthsInternal(), [id]: clampZoneWidth(id, width) };
  localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(next));
  setGraphColumnWidthsInternal(next);
}

export function setGraphZoneVisible(id: GraphZoneId, visible: boolean): void {
  const next = { ...graphColumnVisibilityInternal(), [id]: visible };
  localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(next));
  setGraphColumnVisibilityInternal(next);
}

const [graphColumnMode, setGraphColumnModeInternal] = createSignal<GraphColumnMode>(
  (localStorage.getItem(`${STORAGE_PREFIX}graphColumnMode`) === "compact"
    ? "compact"
    : "default") as GraphColumnMode,
);
export { graphColumnMode };

export function setGraphColumnMode(mode: GraphColumnMode): void {
  localStorage.setItem(`${STORAGE_PREFIX}graphColumnMode`, mode);
  setGraphColumnModeInternal(mode);
}

/// Reset widths to a preset (default or compact). Visibility is
/// untouched — GK's `Reset to default layout` keeps the user's
/// visibility choices.
export function resetGraphColumnsToPreset(mode: GraphColumnMode): void {
  const widths = presetWidths(mode);
  localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  setGraphColumnWidthsInternal(widths);
  setGraphColumnMode(mode);
}

/// Smart Branch Visibility — auto-hide branches with stale tips. GK has
/// a full service for this; chajá's first pass uses a single-knob toggle
/// and a 90-day staleness threshold applied client-side over the ref
/// list (the actual hide flows through the same `hiddenRefs` set so the
/// HiddenRefsButton popover lists them too).
export const [smartBranchesEnabled, setSmartBranchesEnabled] = persistedBool(
  "smartBranchesEnabled",
  false,
);

export const dirtyFileCount = createMemo(() => {
  const s = workingTreeStatus();
  if (!s) return 0;
  const paths = new Set<string>();
  s.unstaged.forEach((c) => paths.add(c.path));
  s.staged.forEach((c) => paths.add(c.path));
  return paths.size;
});

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
}

export function loadRecentRepos(): RecentRepo[] {
  const raw = localStorage.getItem(STORAGE_RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushRecentRepo(path: string): RecentRepo[] {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  const entry: RecentRepo = { path, name, openedAt: Date.now() };
  const list = loadRecentRepos().filter((r) => r.path !== path);
  list.unshift(entry);
  const trimmed = list.slice(0, 10);
  localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(trimmed));
  return trimmed;
}
