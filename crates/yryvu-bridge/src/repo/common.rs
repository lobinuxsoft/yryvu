// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::{
    BackendError, DiffHunk, DiffLine, FileDataType, FileDiff, FileStatus, LineKind,
    DIFF_MAX_FILE_BYTES,
};

/// Extensions GitKraken routes to the image viewer (research doc 09).
/// SVG is included even though it is technically text — GK renders it as
/// an image, not a text diff. Matched case-insensitively.
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "tif", "ico",
];

/// Route a delta to a `FileDataType` for the UI dispatcher. Priority is
/// submodule → oversized → image → binary → deleted → text. Oversized
/// outranks image so a huge image falls back to the binary placeholder
/// (doc 07) instead of being base64-shipped to the viewer; a deleted
/// image still reaches the viewer (missing-new pane) and a deleted
/// binary the binary placeholder. `Directory` is never produced here —
/// file diffs are always leaf files.
fn classify_file_data_type(
    path: &str,
    status: FileStatus,
    new_mode: git2::FileMode,
    old_mode: git2::FileMode,
    is_binary: bool,
    too_large: bool,
) -> FileDataType {
    if new_mode == git2::FileMode::Commit || old_mode == git2::FileMode::Commit {
        return FileDataType::Submodule;
    }
    if too_large {
        return FileDataType::Binary;
    }
    let is_image = path
        .rsplit('.')
        .next()
        .filter(|ext| !ext.is_empty() && *ext != path)
        .map(|ext| ext.to_ascii_lowercase())
        .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.as_str()));
    if is_image {
        return FileDataType::Image;
    }
    if is_binary {
        return FileDataType::Binary;
    }
    if status == FileStatus::Deleted {
        return FileDataType::Deleted;
    }
    FileDataType::Text
}

pub(super) fn open_git2(path: &Path) -> Result<git2::Repository, BackendError> {
    git2::Repository::open(path).map_err(|e| BackendError::Open {
        path: path.display().to_string(),
        source: anyhow::Error::new(e),
    })
}

pub(super) fn git2_err(e: git2::Error) -> BackendError {
    BackendError::Git(anyhow::Error::new(e))
}

pub(super) fn short_sha(oid: &git2::Oid) -> String {
    oid.to_string().chars().take(7).collect()
}

/// Octal string for the file modes git tracks. Returns `None` for the
/// empty/unreadable mode (the missing side of an add/delete) and tree
/// modes (never appear in file diffs).
fn mode_to_octal(mode: git2::FileMode) -> Option<String> {
    match mode {
        git2::FileMode::Blob => Some("100644".into()),
        git2::FileMode::BlobGroupWritable => Some("100664".into()),
        git2::FileMode::BlobExecutable => Some("100755".into()),
        git2::FileMode::Link => Some("120000".into()),
        git2::FileMode::Commit => Some("160000".into()),
        _ => None,
    }
}

pub(crate) fn open_repo(path: &Path) -> Result<gix::Repository, BackendError> {
    gix::open(path).map_err(|e| BackendError::Open {
        path: path.display().to_string(),
        source: anyhow::Error::new(e),
    })
}

/// Convert a `git2::Diff` into the UI-facing `Vec<FileDiff>`. Shared by
/// commit diffs and working-tree diffs. Caller decides whether to call
/// `find_similar` beforehand (renames only make sense for commit diffs).
pub(super) fn diff_to_file_diffs(diff: &git2::Diff) -> Result<Vec<FileDiff>, BackendError> {
    let delta_count = diff.deltas().len();
    let mut files = Vec::with_capacity(delta_count);

    for idx in 0..delta_count {
        let delta = diff
            .get_delta(idx)
            .ok_or_else(|| BackendError::Git(anyhow::anyhow!("delta at index {idx} missing")))?;

        let status = match delta.status() {
            git2::Delta::Added | git2::Delta::Untracked => FileStatus::Added,
            git2::Delta::Modified => FileStatus::Modified,
            git2::Delta::Deleted => FileStatus::Deleted,
            git2::Delta::Renamed => FileStatus::Renamed,
            git2::Delta::Copied => FileStatus::Copied,
            git2::Delta::Typechange => FileStatus::TypeChange,
            git2::Delta::Unmodified => FileStatus::Unmodified,
            _ => FileStatus::Other,
        };

        let new_file = delta.new_file();
        let old_file = delta.old_file();
        let path = new_file
            .path()
            .or_else(|| old_file.path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let old_path = if matches!(status, FileStatus::Renamed | FileStatus::Copied) {
            old_file.path().map(|p| p.to_string_lossy().into_owned())
        } else {
            None
        };
        let new_size = new_file.size();
        let old_size = old_file.size();
        let too_large = new_size > DIFF_MAX_FILE_BYTES || old_size > DIFF_MAX_FILE_BYTES;
        // libgit2 sets `BINARY` (and `DiffFile::is_binary()`) eagerly on
        // files above its internal patch-cost cutoff even when the
        // content is plain text. Above our own size cap we can't trust
        // that signal — the "too large" notice is more accurate copy
        // and lets the UI show a consistent fallback regardless of
        // libgit2's heuristic.
        let is_binary = !too_large
            && (delta.flags().contains(git2::DiffFlags::BINARY)
                || new_file.is_binary()
                || old_file.is_binary());

        let file_data_type = classify_file_data_type(
            &path,
            status,
            new_file.mode(),
            old_file.mode(),
            is_binary,
            too_large,
        );

        // Submodule gitlinks carry the pinned commit OIDs in the delta
        // file ids; a zero oid means that side doesn't exist.
        let (submodule_old_sha, submodule_new_sha) = if file_data_type == FileDataType::Submodule {
            let to_opt = |oid: git2::Oid| (!oid.is_zero()).then(|| oid.to_string());
            (to_opt(old_file.id()), to_opt(new_file.id()))
        } else {
            (None, None)
        };

        let mut file_diff = FileDiff {
            path,
            old_path,
            status,
            file_data_type,
            is_binary,
            truncated: too_large,
            old_size,
            new_size,
            additions: 0,
            deletions: 0,
            hunks: Vec::new(),
            submodule_old_sha,
            submodule_new_sha,
            old_mode: mode_to_octal(old_file.mode()),
            new_mode: mode_to_octal(new_file.mode()),
        };

        if !is_binary && !too_large {
            let patch = git2::Patch::from_diff(diff, idx).map_err(git2_err)?;
            if let Some(patch) = patch {
                let num_hunks = patch.num_hunks();
                for h in 0..num_hunks {
                    let (hunk, line_count) = patch.hunk(h).map_err(git2_err)?;
                    let header = String::from_utf8_lossy(hunk.header())
                        .trim_end()
                        .to_string();
                    let mut lines = Vec::with_capacity(line_count);
                    for l in 0..line_count {
                        let line = patch.line_in_hunk(h, l).map_err(git2_err)?;
                        let kind = match line.origin() {
                            '+' => LineKind::Added,
                            '-' => LineKind::Removed,
                            _ => LineKind::Context,
                        };
                        match kind {
                            LineKind::Added => file_diff.additions += 1,
                            LineKind::Removed => file_diff.deletions += 1,
                            LineKind::Context => {}
                        }
                        let raw = String::from_utf8_lossy(line.content());
                        let content = raw.strip_suffix('\n').unwrap_or(&raw).to_string();
                        lines.push(DiffLine {
                            kind,
                            content,
                            old_line_no: line.old_lineno(),
                            new_line_no: line.new_lineno(),
                        });
                    }
                    file_diff.hunks.push(DiffHunk {
                        old_start: hunk.old_start(),
                        old_count: hunk.old_lines(),
                        new_start: hunk.new_start(),
                        new_count: hunk.new_lines(),
                        header,
                        lines,
                    });
                }
            }
        }

        files.push(file_diff);
    }

    Ok(files)
}

pub(super) fn validate_branch_name(name: &str) -> Result<(), BackendError> {
    if is_invalid_ref_name(name) {
        return Err(BackendError::InvalidBranchName {
            name: name.to_string(),
        });
    }
    Ok(())
}

pub(super) fn validate_tag_name(name: &str) -> Result<(), BackendError> {
    if is_invalid_ref_name(name) {
        return Err(BackendError::InvalidTagName {
            name: name.to_string(),
        });
    }
    Ok(())
}

fn is_invalid_ref_name(name: &str) -> bool {
    name.is_empty()
        || name.starts_with('-')
        || name.contains("..")
        || name.contains(' ')
        || name.contains('\t')
        || name.contains('~')
        || name.contains('^')
        || name.contains(':')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.contains('\\')
        || name.ends_with('/')
        || name.ends_with(".lock")
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::FileMode;

    fn classify(path: &str, status: FileStatus, binary: bool, large: bool) -> FileDataType {
        classify_file_data_type(path, status, FileMode::Blob, FileMode::Blob, binary, large)
    }

    #[test]
    fn submodule_wins_over_everything() {
        let dt = classify_file_data_type(
            "vendor/lib",
            FileStatus::Modified,
            FileMode::Commit,
            FileMode::Blob,
            false,
            false,
        );
        assert_eq!(dt, FileDataType::Submodule);
    }

    #[test]
    fn images_route_to_image_even_when_binary_or_deleted() {
        // Binary content (PNG) still classifies as image, not binary.
        assert_eq!(
            classify("ui/logo.png", FileStatus::Modified, true, false),
            FileDataType::Image
        );
        // A deleted image goes to the viewer (missing-new pane), not Deleted.
        assert_eq!(
            classify("ui/icon.svg", FileStatus::Deleted, false, false),
            FileDataType::Image
        );
        // Extension match is case-insensitive.
        assert_eq!(
            classify("UI/Logo.PNG", FileStatus::Added, true, false),
            FileDataType::Image
        );
        // An oversized image falls back to the binary placeholder (doc 07)
        // rather than being base64-shipped to the viewer.
        assert_eq!(
            classify("ui/huge.png", FileStatus::Modified, false, true),
            FileDataType::Binary
        );
    }

    #[test]
    fn binary_and_oversized_route_to_binary() {
        assert_eq!(
            classify("bin/app", FileStatus::Modified, true, false),
            FileDataType::Binary
        );
        // Oversized text is reported binary (truncated) by the dispatcher.
        assert_eq!(
            classify("data/huge.txt", FileStatus::Modified, false, true),
            FileDataType::Binary
        );
    }

    #[test]
    fn deleted_text_routes_to_deleted_others_to_text() {
        assert_eq!(
            classify("src/main.rs", FileStatus::Deleted, false, false),
            FileDataType::Deleted
        );
        assert_eq!(
            classify("src/main.rs", FileStatus::Modified, false, false),
            FileDataType::Text
        );
        // Extensionless and dotfiles are plain text unless flagged binary.
        assert_eq!(
            classify("Makefile", FileStatus::Modified, false, false),
            FileDataType::Text
        );
        assert_eq!(
            classify(".gitignore", FileStatus::Added, false, false),
            FileDataType::Text
        );
    }
}
