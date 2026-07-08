// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors `yryvu_bridge::backend::SubmoduleInfo`. `head_sha` is the
 * SHA the parent's HEAD tree pins the submodule to; `index_sha` is
 * what the parent's index has staged. `ahead` / `behind` compare the
 * submodule's checked-out HEAD against the parent-pinned commit, and
 * are zero whenever the comparison can't be performed (uninitialized
 * submodule, missing inner repo, missing commit objects).
 */
export interface SubmoduleInfo {
  name: string;
  path: string;
  url: string | null;
  head_sha: string | null;
  index_sha: string | null;
  is_initialized: boolean;
  is_deleted: boolean;
  ahead: number;
  behind: number;
  /// Whether the submodule's working tree has uncommitted changes.
  /// Always false for uninitialized submodules.
  is_dirty: boolean;
}

/**
 * Enumerate every submodule declared in `.gitmodules`. Returns an
 * empty array for repos without submodules.
 */
export function listSubmodules(repoPath: string): Promise<SubmoduleInfo[]> {
  return invoke<SubmoduleInfo[]>("list_submodules", { repoPath });
}

/// Resolve a gitlink OID's commit summary inside the submodule's repo —
/// backs the diff pointer pane (issue #60). `null` when the submodule
/// isn't checked out or the commit isn't fetched locally.
export function submoduleCommitSummary(
  repoPath: string,
  submodulePath: string,
  sha: string
): Promise<string | null> {
  return invoke<string | null>("submodule_commit_summary", {
    repoPath,
    submodulePath,
    sha,
  });
}

/// Initialize a submodule + clone its working tree to the parent-pinned
/// commit. Equivalent to `git submodule update --init <name>`.
export function submoduleInit(repoPath: string, name: string): Promise<void> {
  return invoke<void>("submodule_init", { repoPath, name });
}

/// Fetch + checkout the parent-pinned commit in an already-initialized
/// submodule. Equivalent to `git submodule update <name>`.
export function submoduleUpdate(repoPath: string, name: string): Promise<void> {
  return invoke<void>("submodule_update", { repoPath, name });
}

/// Add a new submodule: clones `url` into `targetPath` (relative to the
/// parent repo) and stages `.gitmodules` + the gitlink. The caller is
/// expected to commit afterwards. `branch` records the tracking branch
/// in `.gitmodules`; `name` overrides the default path-derived name.
/// Equivalent to `git submodule add [--name <n>] [-b <b>] <url> <path>`.
export function submoduleAdd(
  repoPath: string,
  url: string,
  targetPath: string,
  branch?: string,
  name?: string,
): Promise<void> {
  return invoke<void>("submodule_add", {
    repoPath,
    url,
    targetPath,
    branch: branch ?? null,
    name: name ?? null,
  });
}

/// Copy the `.gitmodules` URL into `.git/config` for `name`.
/// Equivalent to `git submodule sync <name>`.
export function submoduleSync(repoPath: string, name: string): Promise<void> {
  return invoke<void>("submodule_sync", { repoPath, name });
}

/// Force-checkout the parent-pinned commit in the submodule's working
/// tree, discarding local changes. Equivalent to
/// `git submodule update --force <name>`.
export function submoduleReset(repoPath: string, name: string): Promise<void> {
  return invoke<void>("submodule_reset", { repoPath, name });
}

/// Unregister an initialized submodule and clear its working tree,
/// keeping `.gitmodules` + the cached gitdir so re-init is cheap.
/// Equivalent to `git submodule deinit -f <name>`.
export function submoduleDeinit(repoPath: string, name: string): Promise<void> {
  return invoke<void>("submodule_deinit", { repoPath, name });
}

/// Per-repo "Keep submodules up to date" tri-state (#98, GK parity).
/// "default" falls through to the global preference.
export type SubmoduleAutoUpdateSetting = "default" | "enabled" | "disabled";

export function getSubmoduleAutoUpdate(
  repoPath: string,
): Promise<SubmoduleAutoUpdateSetting> {
  return invoke<SubmoduleAutoUpdateSetting>("get_submodule_auto_update", {
    repoPath,
  });
}

export function setSubmoduleAutoUpdate(
  repoPath: string,
  value: SubmoduleAutoUpdateSetting,
): Promise<void> {
  return invoke<void>("set_submodule_auto_update", { repoPath, value });
}

/// Post-op hook: backend resolves the tri-state against the global
/// preference and runs `git submodule update --init --recursive` when
/// enabled. Resolves `true` when an update actually ran.
export function submoduleAutoUpdate(repoPath: string): Promise<boolean> {
  return invoke<boolean>("submodule_auto_update", { repoPath });
}

/// Remove a submodule end-to-end: deinit + rm + drop cached gitdir.
/// Stages the resulting `.gitmodules` + index changes; the caller is
/// expected to commit afterwards.
export function submoduleRemove(repoPath: string, name: string): Promise<void> {
  return invoke<void>("submodule_remove", { repoPath, name });
}
