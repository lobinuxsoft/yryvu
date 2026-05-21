// SPDX-License-Identifier: AGPL-3.0-or-later

//! Unidiff buffer rendering for partial staging. Builds the patch text
//! that `git2::Diff::from_buffer` consumes from a freshly-generated
//! `FileDiff` plus a selection of hunks or lines.
//!
//! The `swap` flag flips the patch direction so that unstage/discard can
//! ride on top of forward-apply (libgit2 has no reverse flag). See the
//! parent module header for the full strategy.

use std::collections::{BTreeMap, HashSet};

use crate::backend::{BackendError, DiffHunk, DiffLine, FileDiff, FileStatus, LineKind};

use super::Selection;

pub(super) fn build_unidiff(
    file: &FileDiff,
    selection: &Selection<'_>,
    swap: bool,
) -> Result<(String, bool), BackendError> {
    let mut out = render_file_header(file, swap);
    let mut any_hunk = false;

    match selection {
        Selection::Hunks(indices) => {
            for &idx in indices.iter() {
                let hunk = file.hunks.get(idx).ok_or_else(|| {
                    BackendError::Git(anyhow::anyhow!(
                        "hunk index {idx} out of range (file has {})",
                        file.hunks.len()
                    ))
                })?;
                out.push_str(&render_full_hunk(hunk, swap));
                any_hunk = true;
            }
        }
        Selection::Lines(ranges) => {
            let mut by_hunk: BTreeMap<usize, Vec<u32>> = BTreeMap::new();
            for r in ranges.iter() {
                by_hunk
                    .entry(r.hunk_index)
                    .or_default()
                    .extend(&r.line_indices);
            }
            for (idx, mut lines) in by_hunk {
                let hunk = file.hunks.get(idx).ok_or_else(|| {
                    BackendError::Git(anyhow::anyhow!(
                        "hunk index {idx} out of range (file has {})",
                        file.hunks.len()
                    ))
                })?;
                lines.sort_unstable();
                lines.dedup();
                if let Some(rendered) = render_partial_hunk(hunk, &lines, swap) {
                    out.push_str(&rendered);
                    any_hunk = true;
                }
            }
        }
    }

    Ok((out, any_hunk))
}

fn render_file_header(file: &FileDiff, swap: bool) -> String {
    let (a_path, b_path) = if swap {
        (&file.path, file.old_path.as_ref().unwrap_or(&file.path))
    } else {
        (file.old_path.as_ref().unwrap_or(&file.path), &file.path)
    };

    // libgit2's parser keys off `new file mode` / `deleted file mode` markers
    // to allow the `/dev/null` side; without them it rejects with "mismatched
    // old path names".
    let mode_line = match (file.status, swap) {
        (FileStatus::Added, false) | (FileStatus::Deleted, true) => Some("new file mode 100644"),
        (FileStatus::Added, true) | (FileStatus::Deleted, false) => {
            Some("deleted file mode 100644")
        }
        _ => None,
    };

    let (a_marker, b_marker) = match (file.status, swap) {
        (FileStatus::Added, false) | (FileStatus::Deleted, true) => {
            ("/dev/null".to_string(), format!("b/{b_path}"))
        }
        (FileStatus::Added, true) | (FileStatus::Deleted, false) => {
            (format!("a/{a_path}"), "/dev/null".to_string())
        }
        _ => (format!("a/{a_path}"), format!("b/{b_path}")),
    };

    let mut out = format!("diff --git a/{a_path} b/{b_path}\n");
    if let Some(m) = mode_line {
        out.push_str(m);
        out.push('\n');
    }
    out.push_str(&format!("--- {a_marker}\n+++ {b_marker}\n"));
    out
}

fn render_full_hunk(hunk: &DiffHunk, swap: bool) -> String {
    let mut body = String::new();
    for line in &hunk.lines {
        let (prefix, content) = render_line(line, swap);
        body.push(prefix);
        body.push_str(content);
        body.push('\n');
    }
    let (old_start, old_count, new_start, new_count) = if swap {
        (
            hunk.new_start,
            hunk.new_count,
            hunk.old_start,
            hunk.old_count,
        )
    } else {
        (
            hunk.old_start,
            hunk.old_count,
            hunk.new_start,
            hunk.new_count,
        )
    };
    format!("@@ -{old_start},{old_count} +{new_start},{new_count} @@\n{body}")
}

/// Render a hunk with only the selected `Added`/`Removed` lines applied.
///
/// Behavior depends on `swap` because the patch source flips between
/// "index" (forward stage) and "workdir/index after changes" (reverse
/// unstage/discard):
///
/// | swap | unselected Added         | unselected Removed       |
/// |------|--------------------------|--------------------------|
/// | false| dropped (not in source)  | context (still in both)  |
/// | true | context (still in both)  | dropped (not in source)  |
///
/// Returns `None` if no changed line was selected.
fn render_partial_hunk(hunk: &DiffHunk, selected: &[u32], swap: bool) -> Option<String> {
    let selected_set: HashSet<usize> = selected.iter().map(|&i| i as usize).collect();

    let mut body = String::new();
    let mut old_count = 0u32;
    let mut new_count = 0u32;
    let mut any_change = false;
    let mut push = |prefix: char, content: &str, old_delta: u32, new_delta: u32| {
        body.push(prefix);
        body.push_str(content);
        body.push('\n');
        old_count += old_delta;
        new_count += new_delta;
    };

    for (i, line) in hunk.lines.iter().enumerate() {
        let selected = selected_set.contains(&i);
        match (line.kind, selected, swap) {
            (LineKind::Context, _, _) => push(' ', &line.content, 1, 1),
            (LineKind::Removed, true, false) => {
                push('-', &line.content, 1, 0);
                any_change = true;
            }
            (LineKind::Removed, true, true) => {
                push('+', &line.content, 0, 1);
                any_change = true;
            }
            (LineKind::Removed, false, false) => push(' ', &line.content, 1, 1),
            (LineKind::Removed, false, true) => {}
            (LineKind::Added, true, false) => {
                push('+', &line.content, 0, 1);
                any_change = true;
            }
            (LineKind::Added, true, true) => {
                push('-', &line.content, 1, 0);
                any_change = true;
            }
            (LineKind::Added, false, false) => {}
            (LineKind::Added, false, true) => push(' ', &line.content, 1, 1),
        }
    }

    if !any_change {
        return None;
    }

    let (old_start, new_start) = if swap {
        (hunk.new_start, hunk.old_start)
    } else {
        (hunk.old_start, hunk.new_start)
    };
    Some(format!(
        "@@ -{old_start},{old_count} +{new_start},{new_count} @@\n{body}"
    ))
}

fn render_line(line: &DiffLine, swap: bool) -> (char, &str) {
    let prefix = match (line.kind, swap) {
        (LineKind::Context, _) => ' ',
        (LineKind::Added, false) | (LineKind::Removed, true) => '+',
        (LineKind::Removed, false) | (LineKind::Added, true) => '-',
    };
    (prefix, line.content.as_str())
}
