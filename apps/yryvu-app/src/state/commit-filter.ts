// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Commit filter bar state (issue #111).
 *
 * Chip-based, composable AND filter applied to the graph's visible
 * rows. Five chip types:
 *
 *   - **author** — case-insensitive substring match on author name OR
 *     email.
 *   - **message** — case-insensitive substring match on summary +
 *     body.
 *   - **dateFrom** / **dateTo** — author_date range (inclusive, unix
 *     seconds). Both optional and independent.
 *   - **shaPrefix** — case-insensitive prefix match on full sha.
 *   - **path** — only commits that touched the path. Resolved via
 *     `file_history` so rename-following is included for free.
 *
 * Storage keyed by repo path so different working repos keep
 * independent filter chips.
 */

import { createMemo, createResource, createSignal } from "solid-js";

import { getFileHistory, type GraphRow } from "../ipc";

import { repoPath } from "./repo-base";
import { STORAGE_PREFIX } from "./storage";

export interface CommitFilter {
  author: string;
  message: string;
  /// Unix seconds. `undefined` = no lower bound.
  dateFrom?: number;
  /// Unix seconds. `undefined` = no upper bound.
  dateTo?: number;
  shaPrefix: string;
  path: string;
}

export const EMPTY_FILTER: CommitFilter = {
  author: "",
  message: "",
  shaPrefix: "",
  path: "",
};

function repoKey(): string | undefined {
  const p = repoPath();
  if (!p) return undefined;
  return `${STORAGE_PREFIX}commitFilter.${p}`;
}

function readPersisted(): CommitFilter {
  const k = repoKey();
  if (!k) return { ...EMPTY_FILTER };
  const raw = localStorage.getItem(k);
  if (!raw) return { ...EMPTY_FILTER };
  try {
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY_FILTER,
      ...parsed,
    };
  } catch {
    return { ...EMPTY_FILTER };
  }
}

const [filter, setFilterRaw] = createSignal<CommitFilter>(readPersisted());

export { filter as commitFilter };

export function setCommitFilter(next: CommitFilter | ((prev: CommitFilter) => CommitFilter)): void {
  const resolved = typeof next === "function" ? next(filter()) : next;
  setFilterRaw(resolved);
  const k = repoKey();
  if (!k) return;
  if (isFilterEmpty(resolved)) {
    localStorage.removeItem(k);
    return;
  }
  localStorage.setItem(k, JSON.stringify(resolved));
}

export function clearCommitFilter(): void {
  setCommitFilter({ ...EMPTY_FILTER });
}

export function reloadCommitFilterForRepo(): void {
  setFilterRaw(readPersisted());
}

export function isFilterEmpty(f: CommitFilter): boolean {
  return (
    f.author === "" &&
    f.message === "" &&
    f.shaPrefix === "" &&
    f.path === "" &&
    f.dateFrom === undefined &&
    f.dateTo === undefined
  );
}

export const isCommitFilterActive = createMemo(() => !isFilterEmpty(filter()));

/// SHA set for the active path filter. Resolved via `file_history`
/// (rename-following included). `undefined` = no path filter; `null` =
/// loading; otherwise a frozen Set for O(1) row membership tests.
const [pathShaSet] = createResource<Set<string> | null, readonly [string, string]>(
  () => {
    const path = filter().path;
    const repo = repoPath();
    return path && repo ? ([repo, path] as const) : undefined;
  },
  async ([repo, path]) => {
    const entries = await getFileHistory(repo, path, 5000);
    return new Set(entries.map((e) => e.sha));
  },
);

export { pathShaSet };

/// `true` iff the row passes every active chip (AND semantics). Empty
/// chips short-circuit to `true` so the predicate is identity when no
/// filters are active.
export function matchesCommitFilter(row: GraphRow, f: CommitFilter): boolean {
  if (f.author) {
    const needle = f.author.toLowerCase();
    const hay =
      row.author_name.toLowerCase() + " " + row.author_email.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (f.message) {
    const needle = f.message.toLowerCase();
    const hay = (row.summary + "\n" + row.body).toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (f.shaPrefix) {
    const needle = f.shaPrefix.toLowerCase();
    if (!row.sha.toLowerCase().startsWith(needle)) return false;
  }
  if (f.dateFrom !== undefined && row.author_date < f.dateFrom) return false;
  if (f.dateTo !== undefined && row.author_date > f.dateTo) return false;
  return true;
}

/// Like `matchesCommitFilter` but also honors the async path filter.
/// While the path SHA set is loading, NO row matches (avoids flashing
/// the full graph through then snapping to filtered). Once loaded,
/// rows are intersected against the SHA set.
export function matchesCommitFilterWithPath(
  row: GraphRow,
  f: CommitFilter,
  pathSet: Set<string> | null | undefined,
): boolean {
  if (!matchesCommitFilter(row, f)) return false;
  if (!f.path) return true;
  if (!pathSet) return false;
  return pathSet.has(row.sha);
}
