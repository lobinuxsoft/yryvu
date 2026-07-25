// SPDX-License-Identifier: AGPL-3.0-or-later

//! Diff types: per-file status/metadata, hunks, and the combined
//! multi-revision / WIP-aware diff shapes the inspector renders.

use serde::Serialize;

/// Maximum total diff size Yryvu will materialize per file. Anything larger is
/// returned with `truncated = true` and empty `hunks`.
pub const DIFF_MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChange,
    Unmodified,
    Other,
}

/// How the UI should render a file's diff, mirroring GitKraken's
/// `fileDataTypes` enum (research doc 06). The dispatcher in `DiffView`
/// routes on this value before falling back to the text path:
///
/// - `Text` — Monaco / hunk renderer (the default).
/// - `Image` — side-by-side image viewer + overlay toggle (doc 09).
/// - `Binary` — "Binary file" placeholder (doc 10).
/// - `Submodule` — old/new pointer pane (doc 11).
/// - `Deleted` — text file removed: original-only content + banner (doc 11).
/// - `Directory` — list-only tree node, never rendered in the diff pane;
///   kept for enum parity since file diffs never carry it.
///
/// Classification priority is submodule → image → binary → deleted →
/// text, so a deleted image still routes to the image viewer (with a
/// missing-new pane) and a deleted binary to the binary placeholder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileDataType {
    Text,
    Image,
    Binary,
    Submodule,
    Deleted,
    Directory,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    pub kind: LineKind,
    pub content: String,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

/// Everything the inspector's file list + stat chips need for one file,
/// **minus the hunk bodies**. The combined-diff summary (#178) ships a
/// `Vec<FileDiffMeta>` so a 15K-file WIP diff doesn't serialise every
/// line across the IPC boundary for a view that only reads path + stats;
/// the hunks are fetched per-file when the user opens one.
///
/// The field set is exactly [`FileDiff`] without `hunks` — the two are
/// built by the same `delta_meta` core (see `repo::common`) so a change
/// to binary detection, submodule OIDs, or mode reporting can't drift
/// between the summary and the full diff.
#[derive(Debug, Clone, Serialize)]
pub struct FileDiffMeta {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub file_data_type: FileDataType,
    pub is_binary: bool,
    pub truncated: bool,
    pub old_size: u64,
    pub new_size: u64,
    pub additions: u32,
    pub deletions: u32,
    /// For `FileDataType::Submodule`: the gitlink commit OIDs the parent
    /// pins before/after the change. `None` when the side doesn't exist
    /// (added → no old, deleted → no new) or the file isn't a submodule.
    /// The pointer pane resolves each OID's summary on demand.
    pub submodule_old_sha: Option<String>,
    pub submodule_new_sha: Option<String>,
    /// Octal file modes ("100644" / "100755" / "120000" / "160000")
    /// before/after the change. `None` for the missing side of an
    /// add/delete. When both are present and differ with no content
    /// hunks, the UI shows the "File Mode Changes" pane (issue #60).
    pub old_mode: Option<String>,
    pub new_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub file_data_type: FileDataType,
    pub is_binary: bool,
    pub truncated: bool,
    pub old_size: u64,
    pub new_size: u64,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
    /// For `FileDataType::Submodule`: the gitlink commit OIDs the parent
    /// pins before/after the change. `None` when the side doesn't exist
    /// (added → no old, deleted → no new) or the file isn't a submodule.
    /// The pointer pane resolves each OID's summary on demand.
    pub submodule_old_sha: Option<String>,
    pub submodule_new_sha: Option<String>,
    /// Octal file modes ("100644" / "100755" / "120000" / "160000")
    /// before/after the change. `None` for the missing side of an
    /// add/delete. When both are present and differ with no content
    /// hunks, the UI shows the "File Mode Changes" pane (issue #60).
    pub old_mode: Option<String>,
    pub new_mode: Option<String>,
}

impl FileDiff {
    /// Assemble a full `FileDiff` from its shared metadata plus the hunks
    /// (and their line counts) parsed separately. Keeps the meta core in
    /// one place so summary and full diff can't drift.
    pub fn from_meta(
        meta: FileDiffMeta,
        hunks: Vec<DiffHunk>,
        additions: u32,
        deletions: u32,
    ) -> Self {
        FileDiff {
            path: meta.path,
            old_path: meta.old_path,
            status: meta.status,
            file_data_type: meta.file_data_type,
            is_binary: meta.is_binary,
            truncated: meta.truncated,
            old_size: meta.old_size,
            new_size: meta.new_size,
            additions,
            deletions,
            hunks,
            submodule_old_sha: meta.submodule_old_sha,
            submodule_new_sha: meta.submodule_new_sha,
            old_mode: meta.old_mode,
            new_mode: meta.new_mode,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitDiff {
    pub sha: String,
    pub parent_sha: Option<String>,
    pub files: Vec<FileDiff>,
}

/// Selection variant the right-panel inspector renders. Mirrors GitKraken's
/// branching on `(selectedShas, isWorkDirSelected)` per
/// `docs/research/gitkraken-right-panel/05-stats-and-file-list.md`.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CombinedDiffKind {
    /// Single commit vs its first parent.
    Single,
    /// Two or more commits merged: diff between the first parent of the oldest
    /// commit and the tree of the youngest commit.
    Multi,
    /// Working tree (index + worktree) vs HEAD. Backend treats this as a
    /// distinct kind because the inspector header ("Viewing diff against the
    /// WIP") differs from any committed view.
    WipOnly,
    /// One commit plus the WIP: diff between the commit's tree and the
    /// working tree.
    CommitVsWip,
    /// Two or more commits plus the WIP: diff between the first parent of the
    /// oldest commit and the working tree.
    MultiVsWip,
}

/// Metadata-only twin of [`CombinedDiff`] — same kind / counts / shas, but
/// its `files` carry no hunk bodies (#178). The inspector reads only the
/// per-file stats + path, so this is what the summary IPC ships; the
/// diff view fetches a single file's hunks on demand when the user opens
/// it. Cheap to serialise and parse even for a 15K-file WIP diff.
#[derive(Debug, Clone, Serialize)]
pub struct CombinedDiffSummary {
    pub kind: CombinedDiffKind,
    /// Count of committed rows in the selection. Zero for `WipOnly`.
    pub n_commits: u32,
    pub include_workdir: bool,
    /// Shas considered, youngest-first. Empty for `WipOnly`.
    pub shas: Vec<String>,
    pub files: Vec<FileDiffMeta>,
    /// `true` when rename/copy detection was skipped for exceeding the
    /// delta limit — see [`CombinedDiff::rename_detection_skipped`].
    #[serde(default)]
    pub rename_detection_skipped: bool,
}

/// Result of a multi-revision / WIP-aware diff. Drives the inspector's stat
/// chips, file list, and header copy in one round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct CombinedDiff {
    pub kind: CombinedDiffKind,
    /// Count of committed rows in the selection. Zero for `WipOnly`.
    pub n_commits: u32,
    pub include_workdir: bool,
    /// Shas considered, youngest-first (matching the order the frontend
    /// selects rows in). Empty for `WipOnly`.
    pub shas: Vec<String>,
    pub files: Vec<FileDiff>,
    /// `true` when the backend skipped `find_similar` rename/copy detection
    /// because the diff exceeded `RENAME_DETECTION_DELTA_LIMIT`. Lets the
    /// inspector surface "Rename detection skipped (large diff)" copy without
    /// having to re-derive the decision. Defaults to `false` for normal-sized
    /// diffs.
    #[serde(default)]
    pub rename_detection_skipped: bool,
}
