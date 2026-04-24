// SPDX-License-Identifier: AGPL-3.0-or-later

import { createStore } from "solid-js/store";

import { repoPath } from "../../state";

/// Per-repo persisted settings — 1:1 with GitKraken's `treeViewsByRepoAtom`
/// and `filterQueriesByRepoAtom`.
///
/// `displayTree` — binary tree↔flat toggle (`isContentsTreeDisplayed`).
/// `filterQuery` — substring filter, trimmed lowercase on read.
/// `fullyExpanded` — `treeViewFullyExpanded`: when true, every dir accordion
/// is expanded regardless of the per-dir `collapsedDirs` set.
///
/// Persisted under `chaja.fileList.<field>.<repoId>`. Default repo-id is the
/// repo path itself — good enough until we have stable UUIDs.
interface PersistedRepoState {
  displayTree: boolean;
  filterQuery: string;
  fullyExpanded: boolean;
}

const STORAGE_PREFIX = "chaja.fileList";

function loadPersisted(repoId: string): PersistedRepoState {
  const read = (field: string, fallback: string): string =>
    localStorage.getItem(`${STORAGE_PREFIX}.${field}.${repoId}`) ?? fallback;
  return {
    displayTree: read("displayTree", "1") === "1",
    filterQuery: read("filterQuery", ""),
    fullyExpanded: read("fullyExpanded", "1") === "1",
  };
}

function savePersisted<K extends keyof PersistedRepoState>(
  repoId: string,
  field: K,
  value: PersistedRepoState[K],
): void {
  const raw = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  localStorage.setItem(`${STORAGE_PREFIX}.${field}.${repoId}`, raw);
}

/// Ephemeral per-revision state — `collapsedDirs` is *which* dirs the user
/// has explicitly collapsed (only consulted when `fullyExpanded` is false).
/// `forcedVisible` mirrors `TreeViewFileForcedVisible`: files surfaced past
/// the filter because they're the current selection.
///
/// Reset on `revKey` change (`TreeViewAtShaReset` equivalent), which is
/// cheap — the renderer re-reads from scratch.
interface EphemeralState {
  collapsedDirs: Record<string, true>;
  forcedVisible: Record<string, true>;
}

function makeEphemeral(): EphemeralState {
  return { collapsedDirs: {}, forcedVisible: {} };
}

/// Key combining repoId + revKey + displayMode — matches GK's
/// `replaceTreeViewUsingPureMutator(repoId, shaOrFileListType, isContentsTreeDisplayed)`
/// replacement discipline.
type Key = string;
const ephemeralKey = (repoId: string, revKey: string, isTree: boolean): Key =>
  `${repoId}|${revKey}|${isTree ? "tree" : "flat"}`;

const [persistedByRepo, setPersistedByRepo] = createStore<
  Record<string, PersistedRepoState>
>({});

const [ephemeralByKey, setEphemeralByKey] = createStore<
  Record<Key, EphemeralState>
>({});

function ensurePersisted(repoId: string): PersistedRepoState {
  if (!persistedByRepo[repoId]) {
    setPersistedByRepo(repoId, loadPersisted(repoId));
  }
  return persistedByRepo[repoId]!;
}

function ensureEphemeral(key: Key): EphemeralState {
  if (!ephemeralByKey[key]) {
    setEphemeralByKey(key, makeEphemeral());
  }
  return ephemeralByKey[key]!;
}

/// Repo identifier used as persistence key. Falls back to an empty string
/// when no repo is open (callers should skip rendering then).
export function repoId(): string {
  return repoPath() ?? "";
}

// ---------- persisted accessors ----------

export function displayTree(id: string): boolean {
  return ensurePersisted(id).displayTree;
}

export function setDisplayTree(id: string, value: boolean): void {
  ensurePersisted(id);
  setPersistedByRepo(id, "displayTree", value);
  savePersisted(id, "displayTree", value);
}

export function filterQuery(id: string): string {
  return ensurePersisted(id).filterQuery;
}

export function setFilterQuery(id: string, value: string): void {
  ensurePersisted(id);
  setPersistedByRepo(id, "filterQuery", value);
  savePersisted(id, "filterQuery", value);
}

export function fullyExpanded(id: string): boolean {
  return ensurePersisted(id).fullyExpanded;
}

export function setFullyExpanded(id: string, value: boolean): void {
  ensurePersisted(id);
  setPersistedByRepo(id, "fullyExpanded", value);
  savePersisted(id, "fullyExpanded", value);
}

// ---------- ephemeral accessors ----------

/// Is this directory currently collapsed? Consults both the global
/// `fullyExpanded` flag (short-circuits to *expanded* when true) and the
/// per-dir `collapsedDirs` set.
export function isDirCollapsed(
  id: string,
  revKey: string,
  isTree: boolean,
  dirPath: string,
): boolean {
  if (fullyExpanded(id)) return false;
  const key = ephemeralKey(id, revKey, isTree);
  return ephemeralByKey[key]?.collapsedDirs[dirPath] === true;
}

/// Toggle a single directory's accordion state.
/// `TreeViewDirectoryAccordionToggle` equivalent. Flips `fullyExpanded` to
/// false on first per-dir action — matches GK, which treats "expand all" as
/// a group action that any per-dir toggle invalidates.
export function toggleDirCollapsed(
  id: string,
  revKey: string,
  isTree: boolean,
  dirPath: string,
): void {
  const key = ephemeralKey(id, revKey, isTree);
  ensureEphemeral(key);
  const wasFullyExpanded = fullyExpanded(id);
  if (wasFullyExpanded) setFullyExpanded(id, false);
  const currently =
    ephemeralByKey[key]?.collapsedDirs[dirPath] === true && !wasFullyExpanded;
  if (currently) {
    setEphemeralByKey(key, "collapsedDirs", dirPath, undefined!);
  } else {
    setEphemeralByKey(key, "collapsedDirs", dirPath, true);
  }
}

/// Collapse every directory. `TreeViewAllDirectoriesCollapsedStateSet(true)`.
/// Caller passes the full list of dir paths because the store doesn't know
/// the tree's topology.
export function collapseAllDirs(
  id: string,
  revKey: string,
  isTree: boolean,
  allDirPaths: string[],
): void {
  const key = ephemeralKey(id, revKey, isTree);
  const next: Record<string, true> = {};
  for (const p of allDirPaths) next[p] = true;
  setEphemeralByKey(key, "collapsedDirs", next);
  setFullyExpanded(id, false);
}

/// Expand every directory. `TreeViewAllDirectoriesCollapsedStateSet(false)`.
export function expandAllDirs(id: string, revKey: string, isTree: boolean): void {
  const key = ephemeralKey(id, revKey, isTree);
  setEphemeralByKey(key, "collapsedDirs", {});
  setFullyExpanded(id, true);
}

/// Force a file visible past the filter — `TreeViewFileForcedVisible`.
/// Used when the caller selects a file whose path doesn't match the current
/// filter; still visible so the user sees what's selected.
export function forceFileVisible(
  id: string,
  revKey: string,
  isTree: boolean,
  filePath: string,
): void {
  const key = ephemeralKey(id, revKey, isTree);
  ensureEphemeral(key);
  setEphemeralByKey(key, "forcedVisible", filePath, true);
}

export function isFileForcedVisible(
  id: string,
  revKey: string,
  isTree: boolean,
  filePath: string,
): boolean {
  const key = ephemeralKey(id, revKey, isTree);
  return ephemeralByKey[key]?.forcedVisible[filePath] === true;
}

/// Drop ephemeral state for a given revision. `TreeViewAtShaReset`.
/// Called when the rev key changes (commit re-selected, working-tree
/// status refreshed, …).
export function resetRevState(
  id: string,
  revKey: string,
  isTree: boolean,
): void {
  const key = ephemeralKey(id, revKey, isTree);
  setEphemeralByKey(key, makeEphemeral());
}
