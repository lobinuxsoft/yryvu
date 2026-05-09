// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors `yryvu_bridge::backend::TagInfo`. `target_sha` is always the
 * peeled commit SHA — for annotated tags the wrapping object is decoded
 * server-side. `message` / `tagger_*` are populated only when
 * `is_annotated` is true.
 */
export interface TagInfo {
  name: string;
  full_name: string;
  target_sha: string;
  is_annotated: boolean;
  message: string | null;
  tagger_name: string | null;
  tagger_email: string | null;
  tagger_date: number | null;
}

/**
 * Create a tag pointing at `sha`. A `null`/missing `message` produces a
 * lightweight tag; a non-empty string produces an annotated tag signed with
 * the configured `user.name` / `user.email`.
 */
export function createTag(
  repoPath: string,
  name: string,
  sha: string,
  message: string | null,
): Promise<void> {
  return invoke<void>("create_tag", { repoPath, name, sha, message });
}

/**
 * Delete a local tag (`refs/tags/<name>`). Doesn't touch any remote;
 * use the remote-tag IPCs for that.
 */
export function deleteTag(repoPath: string, name: string): Promise<void> {
  return invoke<void>("delete_tag", { repoPath, name });
}

/**
 * Convert a lightweight tag into an annotated one with `message`.
 * Re-annotates an already-annotated tag in place if called on one.
 * Errors with `invalid-tag-name` when the message is empty after
 * trimming.
 */
export function annotateTag(
  repoPath: string,
  name: string,
  message: string,
): Promise<void> {
  return invoke<void>("annotate_tag", { repoPath, name, message });
}

/**
 * Push a local tag to a named remote
 * (`refs/tags/<name>:refs/tags/<name>`). Annotated and lightweight tags
 * use the same wire format.
 */
export function pushTag(
  repoPath: string,
  remote: string,
  name: string,
): Promise<void> {
  return invoke<void>("push_tag", { repoPath, remote, name });
}

/**
 * Delete a tag on a named remote (`:refs/tags/<name>`). Leaves the
 * local copy intact.
 */
export function deleteTagRemote(
  repoPath: string,
  remote: string,
  name: string,
): Promise<void> {
  return invoke<void>("delete_tag_remote", { repoPath, remote, name });
}

/**
 * List every tag (lightweight + annotated) under `refs/tags/` for the
 * sidebar Tags section. Sorted alphabetically by short name.
 */
export function listTags(repoPath: string): Promise<TagInfo[]> {
  return invoke<TagInfo[]>("list_tags", { repoPath });
}
