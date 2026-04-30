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

/// Per-repo decoration sent back to the frontend. `current_branch` is
/// `None` for detached HEAD or unreadable refs; `dirty_count` is 0 when
/// the working tree is clean OR when the status read failed (the
/// `error` field disambiguates).
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnownRepoInfo {
    pub path: String,
    pub name: String,
    pub current_branch: Option<String>,
    pub dirty_count: u32,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn list_known_repos(paths: Vec<String>) -> Result<Vec<KnownRepoInfo>, String> {
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
        .map(|p| {
            tauri::async_runtime::spawn_blocking(move || describe_repo(&PathBuf::from(p)))
        })
        .collect();

    let mut results = Vec::with_capacity(handles.len());
    for h in handles {
        results.push(h.await.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

fn describe_repo(path: &Path) -> KnownRepoInfo {
    let display_path = path.display().to_string();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path.clone());

    if !path.exists() {
        return KnownRepoInfo {
            path: display_path,
            name,
            current_branch: None,
            dirty_count: 0,
            error: Some("path does not exist".into()),
        };
    }

    let repo = match open_repo(path) {
        Ok(r) => r,
        Err(e) => {
            return KnownRepoInfo {
                path: display_path,
                name,
                current_branch: None,
                dirty_count: 0,
                error: Some(format!("open: {e}")),
            };
        }
    };

    // Current branch — None for detached HEAD or unreadable head_name.
    // The full ref name comes back as `refs/heads/<branch>`; strip the
    // prefix so the UI shows just the branch.
    let current_branch = repo.head_name().ok().flatten().map(|n| {
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
    let (dirty_count, error) = match dirty_summary(path) {
        Ok(n) => (n, None),
        Err(e) => (0, Some(format!("status: {e}"))),
    };

    KnownRepoInfo {
        path: display_path,
        name,
        current_branch,
        dirty_count,
        error,
    }
}
