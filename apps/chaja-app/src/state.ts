// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource, createSignal, type Signal } from "solid-js";

import { getWorkingTreeStatus, type WorkingTreeStatus } from "./ipc";

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

export const [repoPath, setRepoPath] = createSignal<string | undefined>(undefined);
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
/// inspector staging panel.
export const [commitMessage, setCommitMessage] = createSignal("");
export const [commitDescription, setCommitDescription] = createSignal("");
export const [amendEnabled, setAmendEnabled] = createSignal(false);

export function fullCommitMessage(): string {
  const subject = commitMessage().trim();
  const body = commitDescription().trim();
  if (!subject) return "";
  return body ? `${subject}\n\n${body}` : subject;
}

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
