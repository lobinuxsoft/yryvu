// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export type SearchMode = "commits" | "files" | "branches" | "tags" | "stashes";

export interface IndexCounts {
  commits: number;
  files: number;
  branches: number;
  tags: number;
  stashes: number;
}

export interface SearchHit {
  mode: SearchMode;
  idx: number;
  score: number;
  label: string;
  sublabel: string;
}

export function buildSearchIndex(repoPath: string) {
  return invoke<IndexCounts>("build_search_index", { repoPath });
}

export function invalidateSearchIndex(repoPath: string) {
  return invoke<void>("invalidate_search_index", { repoPath });
}

export function searchRepo(
  repoPath: string,
  mode: SearchMode,
  query: string,
  limit?: number,
) {
  return invoke<SearchHit[]>("search_repo", { repoPath, mode, query, limit });
}
