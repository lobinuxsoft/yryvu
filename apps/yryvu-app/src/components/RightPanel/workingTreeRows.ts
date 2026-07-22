// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileDiff } from "../../ipc/diff";
import type { WorkingTreeChange } from "../../ipc/staging";

/// Working-tree changes carry no diffstat (the backend doesn't compute one
/// for the WorkingTreeChange shape). Synthesizing a zero-stat FileDiff lets
/// the FileList widget consume the same row contract as the committed view —
/// the Row's `<Show when={additions>0 || deletions>0}>` guard already hides
/// stats when zero.
///
/// This matches GitKraken, which is not merely missing the numbers but
/// refuses to fetch them: `useFileNodeDiffs` (bundle 10268791) early-returns
/// unless the list type is COMMITTED, so its staging rows never show `+N/-M`
/// either (#151).
export function toFileDiff(change: WorkingTreeChange): FileDiff {
  return {
    path: change.path,
    old_path: change.old_path,
    status: change.status,
    // The working-tree change shape carries no type classification; the
    // FileList row only consumes path/status/stats, so `text` is a safe
    // default that never reaches the diff-pane dispatcher.
    file_data_type: "text",
    is_binary: false,
    truncated: false,
    old_size: 0,
    new_size: 0,
    additions: 0,
    deletions: 0,
    hunks: [],
    submodule_old_sha: null,
    submodule_new_sha: null,
    old_mode: null,
    new_mode: null,
  };
}
