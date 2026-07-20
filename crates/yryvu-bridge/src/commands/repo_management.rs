// SPDX-License-Identifier: AGPL-3.0-or-later

//! Repo Management permanent tab (#209). The frontend keeps the list
//! of "known" repos in localStorage (the recent-opened cache); this
//! backend command takes those paths and decorates each one with the
//! metadata the body needs to render — current branch + dirty status.
//!
//! # Resilience
//!
//! Every per-repo failure surfaces as an `error: Some(reason)` entry on
//! that single result instead of bubbling up — the user almost
//! certainly has at least one stale path in their recents (a deleted
//! repo, a corrupted .git dir, a moved directory). The list-render
//! collapses errored entries to a "missing" state without the rest of
//! the call going dark.

use std::path::{Path, PathBuf};

use crate::repo::common::open_repo;
use crate::repo::staging::dirty_summary;

/// SoA wire envelope for the known-repo list. Four parallel arrays, one
/// slot per repo, aligned by index — `paths[i]` decorates `branches[i]`
/// / `dirty_counts[i]` / `errors[i]`.
///
/// Chosen over `Vec<struct>` (#217, code-standards "Rust SIEMPRE DOD"):
/// one heap allocation per column instead of one per row, tighter cache
/// locality on the columns the frontend actually iterates, and a smaller,
/// more predictable JSON payload (both the IPC response and the
/// localStorage snapshot). `name` is deliberately absent — it's
/// `path.file_name()`, which the frontend derives at render time rather
/// than paying to serialize N times.
///
/// The per-row error pattern is preserved: `branches[i]` / `errors[i]`
/// are independently `None`, so one stale path can't blank the batch.
#[derive(Debug, Default, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnownReposBatch {
    pub paths: Vec<String>,
    pub branches: Vec<Option<String>>,
    pub dirty_counts: Vec<u32>,
    pub errors: Vec<Option<String>>,
}

/// One repo's decoration, produced by a single `describe_repo` task.
/// Internal only — the parallel scan naturally yields one of these per
/// spawned job; [`list_known_repos`] transposes the `Vec` into the SoA
/// [`KnownReposBatch`] at the rendezvous. AoS here is unavoidable (a
/// task computes exactly one repo); the SoA materialization is the wire
/// boundary, which is where it matters.
struct RepoRow {
    path: String,
    branch: Option<String>,
    dirty_count: u32,
    error: Option<String>,
}

#[tauri::command]
pub async fn list_known_repos(paths: Vec<String>) -> Result<KnownReposBatch, String> {
    // Parallelize per-repo work — gix open + working_tree_status are
    // both blocking I/O-heavy. Sequential walk on a list of 10 repos
    // is ~500-2000 ms; spawning each describe onto the tokio blocking
    // pool brings the total down to roughly the slowest single repo.
    //
    // Order of the result Vec preserves the input order — collect the
    // JoinHandles in declaration order, then await them in sequence.
    // Awaiting in order doesn't serialize the work (the spawns already
    // started in parallel), it just rendezvous with each completion.
    let handles: Vec<_> = paths
        .into_iter()
        .map(|p| tauri::async_runtime::spawn_blocking(move || describe_repo(&PathBuf::from(p))))
        .collect();

    let mut batch = KnownReposBatch {
        paths: Vec::with_capacity(handles.len()),
        branches: Vec::with_capacity(handles.len()),
        dirty_counts: Vec::with_capacity(handles.len()),
        errors: Vec::with_capacity(handles.len()),
    };
    for h in handles {
        let row = h.await.map_err(|e| e.to_string())?;
        batch.paths.push(row.path);
        batch.branches.push(row.branch);
        batch.dirty_counts.push(row.dirty_count);
        batch.errors.push(row.error);
    }
    Ok(batch)
}

fn describe_repo(path: &Path) -> RepoRow {
    let display_path = path.display().to_string();

    let row = |branch, dirty_count, error| RepoRow {
        path: display_path.clone(),
        branch,
        dirty_count,
        error,
    };

    if !path.exists() {
        return row(None, 0, Some("path does not exist".into()));
    }

    let repo = match open_repo(path) {
        Ok(r) => r,
        Err(e) => return row(None, 0, Some(format!("open: {e}"))),
    };

    // Current branch — None for detached HEAD or unreadable head_name.
    // The full ref name comes back as `refs/heads/<branch>`; strip the
    // prefix so the UI shows just the branch.
    let branch = repo.head_name().ok().flatten().map(|n| {
        let full: String = n.as_bstr().to_string();
        full.strip_prefix("refs/heads/")
            .map(String::from)
            .unwrap_or(full)
    });

    // Dirty count via the lite dirty_summary helper — counts entries
    // with any non-CURRENT status, no rename detection, no string
    // alloc. ~5-10× faster than the full working_tree_status on
    // dirty-tree repos. Failures collapse to 0 + an error so the row
    // still renders without the dirty pill.
    match dirty_summary(path) {
        Ok(n) => row(branch, n, None),
        Err(e) => row(branch, 0, Some(format!("status: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The SoA batch keeps every column index-aligned and one slot per
    /// input path, including for a path that fails to open — a stale
    /// entry must occupy its slot with an error, not drop out and shift
    /// every following row's branch/dirty onto the wrong path.
    #[tokio::test]
    async fn missing_path_keeps_its_aligned_slot() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().to_path_buf();
        let status = std::process::Command::new("git")
            .args(["init", "-q", "-b", "main"])
            .current_dir(&good)
            .status()
            .expect("git init");
        assert!(status.success());
        let missing = dir.path().join("does-not-exist");

        let batch = list_known_repos(vec![
            missing.display().to_string(),
            good.display().to_string(),
        ])
        .await
        .unwrap();

        assert_eq!(batch.paths.len(), 2);
        assert_eq!(batch.branches.len(), 2);
        assert_eq!(batch.dirty_counts.len(), 2);
        assert_eq!(batch.errors.len(), 2);
        // Input order preserved: slot 0 is the missing path, erroring.
        assert_eq!(batch.paths[0], missing.display().to_string());
        assert!(batch.errors[0].is_some());
        // Slot 1 is the real repo, clean, no error.
        assert_eq!(batch.paths[1], good.display().to_string());
        assert!(batch.errors[1].is_none());
    }
}
