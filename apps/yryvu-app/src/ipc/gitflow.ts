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

// ---- branch operations (issue #19) ----

/// Result of a gitflow / GitHub Flow `finish`. Mirrors
/// `yryvu_bridge::repo::gitflow::ops::FinishOutcome`. A `conflict`
/// leaves the repo merge-in-progress; `tag` (when present) was created
/// on the production branch before the halt.
export type GitflowFinishOutcome =
  | { kind: "completed"; tag: string | null }
  | { kind: "conflict"; paths: string[]; step: string; tag: string | null };

/// Create `{featurePrefix}{name}` off develop and check it out.
export function gitflowFeatureStart(
  repoPath: string,
  name: string,
): Promise<string> {
  return invoke<string>("gitflow_feature_start", { repoPath, name });
}

/// No-ff merge the feature into develop, then optionally delete it.
export function gitflowFeatureFinish(
  repoPath: string,
  name: string,
  keepBranch: boolean,
): Promise<GitflowFinishOutcome> {
  return invoke<GitflowFinishOutcome>("gitflow_feature_finish", {
    repoPath,
    name,
    keepBranch,
  });
}

/// Create `{releasePrefix}{version}` off develop and check it out.
export function gitflowReleaseStart(
  repoPath: string,
  version: string,
): Promise<string> {
  return invoke<string>("gitflow_release_start", { repoPath, version });
}

/// No-ff merge the release into production + develop, tag production
/// (`{versionTagPrefix}{version}`, empty message => lightweight), then
/// optionally delete.
export function gitflowReleaseFinish(
  repoPath: string,
  version: string,
  tagMessage: string,
  keepBranch: boolean,
): Promise<GitflowFinishOutcome> {
  return invoke<GitflowFinishOutcome>("gitflow_release_finish", {
    repoPath,
    version,
    tagMessage,
    keepBranch,
  });
}

/// Create `{hotfixPrefix}{version}` off production and check it out.
export function gitflowHotfixStart(
  repoPath: string,
  version: string,
): Promise<string> {
  return invoke<string>("gitflow_hotfix_start", { repoPath, version });
}

/// No-ff merge the hotfix into production + develop, tag production,
/// then optionally delete.
export function gitflowHotfixFinish(
  repoPath: string,
  version: string,
  tagMessage: string,
  keepBranch: boolean,
): Promise<GitflowFinishOutcome> {
  return invoke<GitflowFinishOutcome>("gitflow_hotfix_finish", {
    repoPath,
    version,
    tagMessage,
    keepBranch,
  });
}

/// GitHub Flow: branch off `base` (no prefix, no config required).
export function githubFlowStart(
  repoPath: string,
  base: string,
  name: string,
): Promise<string> {
  return invoke<string>("github_flow_start", { repoPath, base, name });
}

/// GitHub Flow finish: no-ff merge back into `base`, then optionally
/// delete the branch.
export function githubFlowFinish(
  repoPath: string,
  base: string,
  name: string,
  keepBranch: boolean,
): Promise<GitflowFinishOutcome> {
  return invoke<GitflowFinishOutcome>("github_flow_finish", {
    repoPath,
    base,
    name,
    keepBranch,
  });
}
