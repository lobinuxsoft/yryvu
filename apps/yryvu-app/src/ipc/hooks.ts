// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `yryvu_bridge::repo::hooks::HookEntry`. The `path` field is
/// the absolute on-disk path, already accounting for the `.disabled`
/// suffix when applicable — the frontend doesn't need to recompute it.
export interface HookEntry {
  name: string;
  enabled: boolean;
  path: string;
}

/// List the hooks in the active hooks directory for a repo. Resolves
/// `core.hooksPath` first; falls back to `<repo>/.git/hooks`. Empty
/// vec when the directory doesn't exist.
export function listHooks(repoPath: string): Promise<HookEntry[]> {
  return invoke<HookEntry[]>("list_hooks", { repoPath });
}

/// Toggle a hook by renaming the file to/from the `.disabled` suffix.
/// Idempotent — calling with the current state is a no-op. Errors with
/// NotFound when neither the active nor `.disabled` file exists.
export function setHookEnabled(
  repoPath: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>("set_hook_enabled", { repoPath, name, enabled });
}

/// Open a hook script with the OS default app for shell scripts. The
/// backend resolves the on-disk file (active or `.disabled`) before
/// delegating to `tauri-plugin-opener`.
export function openHookScript(repoPath: string, name: string): Promise<void> {
  return invoke<void>("open_hook_script", { repoPath, name });
}
