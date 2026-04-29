// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors `chaja_bridge::backend::TagInfo`. `target_sha` is always the
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
 * List every tag (lightweight + annotated) under `refs/tags/` for the
 * sidebar Tags section. Sorted alphabetically by short name.
 */
export function listTags(repoPath: string): Promise<TagInfo[]> {
  return invoke<TagInfo[]>("list_tags", { repoPath });
}
