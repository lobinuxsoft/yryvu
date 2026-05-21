// SPDX-License-Identifier: AGPL-3.0-or-later

//! Interactive rebase: planner + custom orchestrator. libgit2 has no
//! `git-rebase-todo` editor, so yryvu walks the plan via cherry-pick +
//! amend primitives. See [`exec`] for the runtime and [`plan`] for the
//! IPC-facing types.

mod exec;
mod plan;

#[cfg(test)]
mod tests;

use std::path::Path;

use git2::Oid;

use crate::backend::BackendError;

use super::super::common::{git2_err, open_git2};

#[allow(unused_imports)]
pub use exec::{abort_rebase, begin_rebase, continue_rebase, get_state, skip_step};
#[allow(unused_imports)]
pub use plan::{CommitSummary, PauseReason, RebaseAction, RebasePlan, RebaseState, RebaseStep};

/// List commits eligible for an interactive rebase: HEAD reachable
/// commits that are NOT reachable from `upstream`. Order is HEAD-first
/// (`revwalk` default — parent-after-child) which matches what the
/// picker UI shows (newest at the top).
///
/// Merge commits (parent_count > 1) are filtered out — `git rebase`
/// drops them by default (only `--rebase-merges` preserves them) and
/// `libgit2`'s cherry-pick refuses to apply them without an explicit
/// mainline parent. Re-creating the merge on a different base is a
/// rewrite, not a rebase, so dropping is the correct default.
pub fn list_commits_for_rebase(
    repo_path: &Path,
    upstream: &str,
) -> Result<Vec<CommitSummary>, BackendError> {
    let repo = open_git2(repo_path)?;
    let head = repo
        .head()
        .and_then(|r| r.peel_to_commit())
        .map_err(git2_err)?;
    let upstream_oid = Oid::from_str(upstream).map_err(git2_err)?;

    let mut revwalk = repo.revwalk().map_err(git2_err)?;
    revwalk.push(head.id()).map_err(git2_err)?;
    revwalk.hide(upstream_oid).map_err(git2_err)?;

    let mut out = Vec::new();
    for oid in revwalk {
        let oid = oid.map_err(git2_err)?;
        let commit = repo.find_commit(oid).map_err(git2_err)?;
        if commit.parent_count() > 1 {
            continue;
        }
        let oid_str = oid.to_string();
        let short_oid = oid_str.chars().take(7).collect();
        out.push(CommitSummary {
            oid: oid_str,
            short_oid,
            summary: commit.summary().unwrap_or("").to_string(),
            author_name: commit.author().name().unwrap_or("").to_string(),
            author_email: commit.author().email().unwrap_or("").to_string(),
        });
    }
    Ok(out)
}
