// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `yryvu_bridge::repo::sparse_checkout::SparseCheckoutState`.
/// `patterns` are the non-blank / non-comment lines from
/// `.git/info/sparse-checkout`, order preserved.
export interface SparseCheckoutState {
  enabled: boolean;
  coneMode: boolean;
  patterns: string[];
}

/// Read the repo's current sparse-checkout state. All fields false /
/// empty when sparse is not enabled.
export function getSparseCheckoutState(
  repoPath: string,
): Promise<SparseCheckoutState> {
  return invoke<SparseCheckoutState>("get_sparse_checkout_state", { repoPath });
}

/// `git sparse-checkout init [--cone]` — enables sparse-checkout for
/// the repo and seeds the patterns file. Does not write user patterns
/// until `sparseSetPatterns` follows.
export function sparseInit(
  repoPath: string,
  coneMode: boolean,
): Promise<void> {
  return invoke<void>("sparse_init", { repoPath, coneMode });
}

/// `git sparse-checkout set [--cone] <patterns...>` — overwrites the
/// patterns file and updates the working tree to match.
export function sparseSetPatterns(
  repoPath: string,
  coneMode: boolean,
  patterns: string[],
): Promise<void> {
  return invoke<void>("sparse_set_patterns", {
    repoPath,
    coneMode,
    patterns,
  });
}

/// `git sparse-checkout disable` — restores every file and turns the
/// `core.sparseCheckout` bit off.
export function sparseDisable(repoPath: string): Promise<void> {
  return invoke<void>("sparse_disable", { repoPath });
}

/// `git sparse-checkout reapply` — re-runs the existing patterns
/// against the working tree (useful after pull / fetch).
export function sparseReapply(repoPath: string): Promise<void> {
  return invoke<void>("sparse_reapply", { repoPath });
}
