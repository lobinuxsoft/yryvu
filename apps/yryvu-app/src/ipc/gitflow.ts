// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `yryvu_bridge::repo::gitflow::GitflowConfig`. Lives in the
/// repo's `.git/config [gitflow]` block, not user-wide preferences —
/// every field is per-repo.
export interface GitflowConfig {
  masterBranch: string;
  developBranch: string;
  featurePrefix: string;
  releasePrefix: string;
  hotfixPrefix: string;
  bugfixPrefix: string;
  supportPrefix: string;
  versionTagPrefix: string;
}

/// Read the `[gitflow]` block. Returns `null` when no gitflow keys
/// are present (treat as "not initialised").
export function readGitflowConfig(
  repoPath: string,
): Promise<GitflowConfig | null> {
  return invoke<GitflowConfig | null>("read_gitflow_config", { repoPath });
}

/// Persist every field of `config` under `[gitflow]` in the repo's
/// local config.
export function writeGitflowConfig(
  repoPath: string,
  config: GitflowConfig,
): Promise<void> {
  return invoke<void>("write_gitflow_config", { repoPath, config });
}

/// Backend-provided canonical defaults (`main` / `develop` / standard
/// prefixes). Use as the seed for an uninitialized repo.
export function gitflowDefaults(): Promise<GitflowConfig> {
  return invoke<GitflowConfig>("gitflow_defaults");
}
