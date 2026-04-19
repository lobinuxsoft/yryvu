// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

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
