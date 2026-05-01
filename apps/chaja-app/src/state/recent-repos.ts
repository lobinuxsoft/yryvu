// SPDX-License-Identifier: AGPL-3.0-or-later

import { STORAGE_PREFIX } from "./storage";

const STORAGE_RECENT_KEY = `${STORAGE_PREFIX}recentRepos`;

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

/// Remove one path from the recent-repos cache. Used by Repo Management
/// when the user clears a stale entry (deleted directory, moved repo)
/// or bulk-removes a selection.
export function removeRecentRepo(path: string): RecentRepo[] {
  const list = loadRecentRepos().filter((r) => r.path !== path);
  localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(list));
  return list;
}
