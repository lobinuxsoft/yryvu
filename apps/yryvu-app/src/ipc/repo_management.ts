// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// SoA wire envelope — mirrors `yryvu_bridge::commands::repo_management::
/// KnownReposBatch`. Four parallel arrays aligned by index: `paths[i]`
/// is decorated by `branches[i]` / `dirtyCounts[i]` / `errors[i]`.
/// `null` in `branches` / `errors` is serde's `Option::None`. `name` is
/// intentionally absent — it's derivable from the path, so the backend
/// doesn't serialize it N times (see `repoNameFromPath`).
export interface KnownReposBatch {
  paths: string[];
  branches: (string | null)[];
  dirtyCounts: number[];
  errors: (string | null)[];
}

/// Per-row render model — never crosses the wire. Rehydrated from
/// [`KnownReposBatch`] with `name` derived and `searchKey` precomputed
/// once at fetch time, so the filter is a pure `includes()` on a ready
/// string instead of lowercasing three fields on every keystroke.
export interface KnownRepoRow {
  path: string;
  name: string;
  currentBranch: string | null;
  dirtyCount: number;
  error: string | null;
  searchKey: string;
}

/// Last path segment, split on both separators so a Windows path
/// (`C:\src\repo`) yields `repo` just like a POSIX one. Falls back to
/// the whole path when there's no segment (e.g. a bare drive root).
export function repoNameFromPath(path: string): string {
  const segs = path.split(/[/\\]/).filter(Boolean);
  return segs.length > 0 ? segs[segs.length - 1] : path;
}

/// Materialize the SoA batch into render rows, deriving `name` and
/// precomputing the lowercased `searchKey`. A branch/error length
/// mismatch (corrupt snapshot) degrades to `null` per slot rather than
/// throwing — one bad column can't blank the list.
export function rehydrateBatch(batch: KnownReposBatch): KnownRepoRow[] {
  return batch.paths.map((path, i) => {
    const name = repoNameFromPath(path);
    const currentBranch = batch.branches[i] ?? null;
    return {
      path,
      name,
      currentBranch,
      dirtyCount: batch.dirtyCounts[i] ?? 0,
      error: batch.errors[i] ?? null,
      searchKey: `${name}\n${path}\n${currentBranch ?? ""}`.toLowerCase(),
    };
  });
}

export function listKnownRepos(paths: string[]): Promise<KnownReposBatch> {
  return invoke<KnownReposBatch>("list_known_repos", { paths });
}
