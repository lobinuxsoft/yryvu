// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { FileDiff, FileStatus } from "./diff";

export interface WorkingTreeChange {
  path: string;
  old_path: string | null;
  status: FileStatus;
}

export interface WorkingTreeStatus {
  unstaged: WorkingTreeChange[];
  staged: WorkingTreeChange[];
}

export function getWorkingTreeStatus(
  repoPath: string
): Promise<WorkingTreeStatus> {
  return invoke<WorkingTreeStatus>("working_tree_status", { repoPath });
}

export function stageFiles(repoPath: string, paths: string[]): Promise<void> {
  return invoke<void>("stage_files", { repoPath, paths });
}

export function unstageFiles(repoPath: string, paths: string[]): Promise<void> {
  return invoke<void>("unstage_files", { repoPath, paths });
}

/// Stage / unstage only a file-mode change (issue #60) — distinct from
/// content staging so the UI can surface mode-specific errors.
export function stageFilemode(repoPath: string, path: string): Promise<void> {
  return invoke<void>("stage_filemode", { repoPath, path });
}

export function unstageFilemode(repoPath: string, path: string): Promise<void> {
  return invoke<void>("unstage_filemode", { repoPath, path });
}

export function getUnstagedDiff(
  repoPath: string,
  path: string
): Promise<FileDiff> {
  return invoke<FileDiff>("diff_unstaged", { repoPath, path });
}

export function getStagedDiff(
  repoPath: string,
  path: string
): Promise<FileDiff> {
  return invoke<FileDiff>("diff_staged", { repoPath, path });
}

export function commitStaged(
  repoPath: string,
  message: string
): Promise<string> {
  return invoke<string>("commit_staged", { repoPath, message });
}

export function amendCommit(
  repoPath: string,
  message: string
): Promise<string> {
  return invoke<string>("amend_commit", { repoPath, message });
}

export function getHeadCommitMessage(repoPath: string): Promise<string> {
  return invoke<string>("head_commit_message", { repoPath });
}

export function stageAll(repoPath: string): Promise<string[]> {
  return invoke<string[]>("stage_all", { repoPath });
}

export function unstageAll(repoPath: string): Promise<string[]> {
  return invoke<string[]>("unstage_all", { repoPath });
}

/// Destructively revert unstaged changes. Tracked paths snap back to HEAD;
/// untracked files are deleted from disk. Caller must confirm with the user
/// beforehand — there is no undo.
export function discardPaths(
  repoPath: string,
  paths: string[]
): Promise<void> {
  return invoke<void>("discard_paths", { repoPath, paths });
}

/// Options bundle mirroring the backend `CommitOptions` (serde camelCase).
/// `skipHooks` is a no-op on the git2 backend — kept for API parity.
/// `gpgSign=true` currently errors with `NotImplemented`.
export interface CommitOptions {
  summary: string;
  description?: string;
  amend?: boolean;
  skipHooks?: boolean;
  gpgSign?: boolean;
}

export function createCommit(
  repoPath: string,
  options: CommitOptions
): Promise<string> {
  return invoke<string>("create_commit", { repoPath, options });
}

export function commitAndPush(
  repoPath: string,
  options: CommitOptions
): Promise<string> {
  return invoke<string>("commit_and_push", { repoPath, options });
}

/// One slice of changed lines within a hunk for partial line-level
/// staging. `lineIndices` references positions into `DiffHunk.lines`
/// (0-based); only `added` / `removed` entries are honored backend-side
/// — `context` indices are silently ignored.
export interface LineRange {
  hunkIndex: number;
  lineIndices: number[];
}

export function stageHunks(
  repoPath: string,
  path: string,
  hunkIndices: number[]
): Promise<void> {
  return invoke<void>("stage_hunks", { repoPath, path, hunkIndices });
}

export function unstageHunks(
  repoPath: string,
  path: string,
  hunkIndices: number[]
): Promise<void> {
  return invoke<void>("unstage_hunks", { repoPath, path, hunkIndices });
}

/// Destructive — discards the selected hunks from the workdir. Caller
/// MUST confirm with the user beforehand (there is no undo).
export function discardHunks(
  repoPath: string,
  path: string,
  hunkIndices: number[]
): Promise<void> {
  return invoke<void>("discard_hunks", { repoPath, path, hunkIndices });
}

export function stageLines(
  repoPath: string,
  path: string,
  ranges: LineRange[]
): Promise<void> {
  return invoke<void>("stage_lines", { repoPath, path, ranges });
}

export function unstageLines(
  repoPath: string,
  path: string,
  ranges: LineRange[]
): Promise<void> {
  return invoke<void>("unstage_lines", { repoPath, path, ranges });
}

/// Destructive — discards the selected lines from the workdir. Caller
/// MUST confirm with the user beforehand.
export function discardLines(
  repoPath: string,
  path: string,
  ranges: LineRange[]
): Promise<void> {
  return invoke<void>("discard_lines", { repoPath, path, ranges });
}

export type SignFormat = "open-pgp" | "ssh";

/// Snapshot of the repo's signing config — mirrors
/// `yryvu_bridge::backend::SignConfig`. `key === null` means
/// `user.signingkey` is not set; the commit panel renders the Sign
/// toggle disabled with a hint pointing the user to git config.
export interface SignConfig {
  format: SignFormat;
  key: string | null;
  program: string;
  userName: string | null;
  userEmail: string | null;
}

export function getCommitSignConfig(repoPath: string): Promise<SignConfig> {
  return invoke<SignConfig>("commit_sign_config", { repoPath });
}

/// Request payload for `generate_gpg_key`. Empty `passphrase` skips
/// protection (`%no-protection` in the gpg batch recipe); non-empty
/// loops through gpg's loopback pinentry.
export interface GenerateKeyRequest {
  name: string;
  email: string;
  passphrase: string;
}

export interface GeneratedKey {
  keyId: string;
  fingerprint: string;
  publicKeyArmored: string;
}

/// Spawn `gpg --batch --gen-key` with RSA 4096 / 2y expiry — mirrors
/// GitKraken's `GPGPreferences-GpgGenerateKey` action. Returns the new
/// fingerprint, short key id, and armored public key (ready to paste
/// into GitHub's "Add new GPG key" form).
export function generateGpgKey(
  req: GenerateKeyRequest
): Promise<GeneratedKey> {
  return invoke<GeneratedKey>("generate_gpg_key", { req });
}

/// Export an existing public key as armored text. Accepts any selector
/// `gpg --export` understands — fingerprint, long key id, short key id,
/// or email. Used by the GPG preferences panel's "Copy public key"
/// button so users can grab a previously-generated key on demand.
export function exportGpgPublicKey(selector: string): Promise<string> {
  return invoke<string>("export_gpg_public_key", { selector });
}

export interface GpgKeyInfo {
  keyId: string;
  fingerprint: string;
  uid: string;
}

/// List OpenPGP secret keys present in the user's gpg keyring. Empty
/// list means either gpg is missing or no keys are configured —
/// preferences UI offers the "Generate new GPG Key" path in that case.
export function listGpgKeys(): Promise<GpgKeyInfo[]> {
  return invoke<GpgKeyInfo[]>("list_gpg_keys");
}

/// Write `user.signingkey` + `gpg.format` into the repo's local git
/// config. Called automatically after a successful generate so the
/// next commit picks the new key up.
export function setSigningKey(
  repoPath: string,
  key: string,
  format: SignFormat
): Promise<void> {
  return invoke<void>("set_signing_key", { repoPath, key, format });
}
