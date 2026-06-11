// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import { STORAGE_PREFIX } from "./storage";

/// Per-remote folder collapse state for the REMOTE sidebar section
/// (#239). Keyed per-(repoPath, remoteName) so reopening a repo
/// restores its layout without leaking another repo's state — mirrors
/// GK's `getCollapsedRemotes` (audit doc 03), which stores only the
/// collapsed names (folders default to expanded).
const COLLAPSED_REMOTES_KEY = `${STORAGE_PREFIX}collapsedRemoteFolders`;

type CollapsedByRepo = Record<string, string[]>;

function loadCollapsedByRepo(): CollapsedByRepo {
  const raw = localStorage.getItem(COLLAPSED_REMOTES_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const result: CollapsedByRepo = {};
    for (const [repo, names] of Object.entries(parsed)) {
      if (!Array.isArray(names)) continue;
      const valid = names.filter((n): n is string => typeof n === "string");
      if (valid.length > 0) result[repo] = valid;
    }
    return result;
  } catch {
    return {};
  }
}

function persistCollapsedByRepo(value: CollapsedByRepo): void {
  localStorage.setItem(COLLAPSED_REMOTES_KEY, JSON.stringify(value));
}

const [collapsedByRepoInternal, setCollapsedByRepoInternal] =
  createSignal<CollapsedByRepo>(loadCollapsedByRepo());

/// Reactive set of collapsed remote-folder names for `repo`. Empty set
/// (everything expanded) when the repo has no persisted entry.
export function collapsedRemoteFolders(repo: string): Set<string> {
  return new Set(collapsedByRepoInternal()[repo] ?? []);
}

/// Toggle the collapse state of `remote`'s folder row in `repo`.
/// Persists across restarts; entries are dropped (not stored as
/// `false`) when a folder returns to the expanded default so the
/// storage stays sparse.
export function toggleRemoteFolderCollapsed(repo: string, remote: string): void {
  const all = { ...collapsedByRepoInternal() };
  const current = new Set(all[repo] ?? []);
  if (current.has(remote)) current.delete(remote);
  else current.add(remote);
  if (current.size === 0) delete all[repo];
  else all[repo] = Array.from(current);
  persistCollapsedByRepo(all);
  setCollapsedByRepoInternal(all);
}
