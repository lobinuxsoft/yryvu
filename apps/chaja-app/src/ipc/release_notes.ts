// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `chaja_bridge::commands::release_notes::ChangelogContents`.
/// `present: false` means the file doesn't exist (pre-first-release
/// builds); `present: true, markdown: ""` is a real-but-empty changelog.
export interface ChangelogContents {
  present: boolean;
  markdown: string;
}

export function readChangelog(): Promise<ChangelogContents> {
  return invoke<ChangelogContents>("read_changelog");
}
