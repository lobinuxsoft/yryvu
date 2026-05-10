// SPDX-License-Identifier: AGPL-3.0-or-later

import { createStore, produce } from "solid-js/store";

import { repoPath } from "../../state";

/// Per-repo persisted settings — 1:1 with GitKraken's `treeViewsByRepoAtom`
/// and `filterQueriesByRepoAtom`. Only display-mode + filter persist; the
/// expansion state is session-scoped and matches GK's redux behavior (no
/// `treeViewFullyExpanded` flag stored — GK derives it live from the tree
/// via `isTreeViewFullyExpanded(node) = !node.collapsed && every(children,
/// …)`).
///
/// Persisted under `yryvu.fileList.<field>.<repoId>`. Default repo-id is the
/// repo path itself — good enough until we have stable UUIDs.
interface PersistedRepoState {
  displayTree: boolean;
  filterQuery: string;
}

const STORAGE_PREFIX = "yryvu.fileList";

function loadPersisted(repoId: string): PersistedRepoState {
  const read = (field: string, fallback: string): string =>
    localStorage.getItem(`${STORAGE_PREFIX}.${field}.${repoId}`) ?? fallback;
  return {
    displayTree: read("displayTree", "1") === "1",
    filterQuery: read("filterQuery", ""),
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

/// Ephemeral per-revision state. `collapsedDirs` is the **single source of
/// truth** for expansion — a dir is collapsed iff its path is a key here.
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

// ---------- ephemeral accessors ----------

/// Source of truth: only the per-`(id, revKey, isTree)` `collapsedDirs` set.
/// No global flag — matches GK's `setEveryNodeInTreeViewIsCollapsed` model.
export function isDirCollapsed(
  id: string,
  revKey: string,
  isTree: boolean,
  dirPath: string,
): boolean {
  const key = ephemeralKey(id, revKey, isTree);
  return ephemeralByKey[key]?.collapsedDirs[dirPath] === true;
}

/// Toggle a single directory's accordion state. `TreeViewDirectoryAccordionToggle`
/// equivalent. Per-path mutation keeps Solid's path-based reactivity wiring
/// for already-mounted rows.
export function toggleDirCollapsed(
  id: string,
  revKey: string,
  isTree: boolean,
  dirPath: string,
): void {
  const key = ephemeralKey(id, revKey, isTree);
  ensureEphemeral(key);
  const currently = ephemeralByKey[key]?.collapsedDirs[dirPath] === true;
  if (currently) {
    setEphemeralByKey(key, "collapsedDirs", dirPath, undefined!);
  } else {
    setEphemeralByKey(key, "collapsedDirs", dirPath, true);
  }
}

/// Collapse every directory in the visible tree.
/// `TreeViewAllDirectoriesCollapsedStateSet(true)`. `produce` mutates the
/// `collapsedDirs` record per-path so each individual row's reactive read
/// fires — replacing the whole object reference breaks Solid stores'
/// path-based reactivity for descendants already accessed.
export function collapseAllDirs(
  id: string,
  revKey: string,
  isTree: boolean,
  allDirPaths: string[],
): void {
  const key = ephemeralKey(id, revKey, isTree);
  ensureEphemeral(key);
  setEphemeralByKey(
    key,
    "collapsedDirs",
    produce((c: Record<string, true>) => {
      for (const p of allDirPaths) c[p] = true;
    }),
  );
}

/// Expand every directory. `TreeViewAllDirectoriesCollapsedStateSet(false)`.
/// Iterates current keys and deletes each — per-path mutation again so
/// row-level reactive reads fire on flip.
export function expandAllDirs(
  id: string,
  revKey: string,
  isTree: boolean,
): void {
  const key = ephemeralKey(id, revKey, isTree);
  ensureEphemeral(key);
  setEphemeralByKey(
    key,
    "collapsedDirs",
    produce((c: Record<string, true>) => {
      for (const p of Object.keys(c)) delete c[p];
    }),
  );
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

/// Reactive predicate driving the toolbar's Expand/Collapse-all label. Any
/// entry in `collapsedDirs` ⇒ at least one dir collapsed. Mirrors GK's
/// derived `!isTreeViewFullyExpanded`.
export function hasAnyCollapsed(
  id: string,
  revKey: string,
  isTree: boolean,
): boolean {
  const key = ephemeralKey(id, revKey, isTree);
  const state = ephemeralByKey[key];
  if (!state) return false;
  for (const _ in state.collapsedDirs) return true;
  return false;
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
