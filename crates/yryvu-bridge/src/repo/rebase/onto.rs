// SPDX-License-Identifier: AGPL-3.0-or-later

//! Rebase ops. libgit2 wraps the rebase machinery as
//! `Repository::rebase` + `Rebase::next` per-step iteration; chajá
//! exposes the GK happy-path: rebase HEAD onto a target ref, abort on
//! the first conflict so the user can resolve via the worktree
//! manually (a future PR can wire interactive resolution).

use std::path::Path;

use anyhow::anyhow;

use crate::backend::BackendError;
use crate::undo_log::clear_log_best_effort;

use super::super::common::{git2_err, open_git2};

/// Rebase the current branch onto `target_branch`. Equivalent to
/// `git rebase <target_branch>` from HEAD.
///
/// Returns `Ok(())` on a clean rebase. On conflict the rebase is
/// aborted (the worktree is restored to the pre-rebase state) and an
/// error is surfaced — chajá doesn't yet wrap the per-step
/// resolution flow.
///
/// Refuses on detached HEAD: rebase requires a branch to update.
///
/// **Undo log:** rebase rewrites HEAD's chain with fresh SHAs, which
/// leaves the prior log entries pointing at orphan commits. The
/// inverses would still apply mechanically (the orphan SHAs survive in
/// the object store), but the result lands the user on the pre-rebase
/// chain — surprising and unwanted. Same trade-off as stash drop:
/// clear the log so subsequent Undo honestly reports "nothing to
/// undo." A future PR can introduce a dedicated `OpKind::Rebase` with
/// `pre_sha` so the rebase itself becomes a single-step undo.
pub fn rebase_current_onto(repo_path: &Path, target_branch: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;

    let head = repo.head().map_err(git2_err)?;
    if !head.is_branch() {
        return Err(BackendError::Git(anyhow!(
            "HEAD is detached; check out a branch before rebasing"
        )));
    }

    // Try Local first, fall back to Remote so the same op handles both
    // sub-PR 2 (#221: Rebase current onto a local branch) and sub-PR 3
    // (#222: Rebase current onto a remote-tracking ref like origin/main).
    let upstream_ref = repo
        .find_branch(target_branch, git2::BranchType::Local)
        .or_else(|_| repo.find_branch(target_branch, git2::BranchType::Remote))
        .map_err(|_| BackendError::BranchNotFound {
            name: target_branch.to_string(),
        })?
        .into_reference();
    let upstream_annotated = repo
        .reference_to_annotated_commit(&upstream_ref)
        .map_err(git2_err)?;

    let head_annotated = repo
        .reference_to_annotated_commit(&head)
        .map_err(git2_err)?;

    let mut opts = git2::RebaseOptions::new();
    let mut rebase = repo
        .rebase(
            Some(&head_annotated),
            Some(&upstream_annotated),
            None,
            Some(&mut opts),
        )
        .map_err(git2_err)?;

    let sig = repo.signature().map_err(git2_err)?;
    while let Some(step) = rebase.next() {
        step.map_err(git2_err)?;
        if let Err(e) = rebase.commit(None, &sig, None) {
            // Conflict or other failure mid-rebase. Roll back so the
            // worktree is restored before surfacing the error — chajá
            // doesn't expose the per-step resolution flow yet.
            let _ = rebase.abort();
            return Err(BackendError::Git(anyhow!(
                "rebase aborted (conflicts likely): {e}"
            )));
        }
    }
    rebase.finish(Some(&sig)).map_err(git2_err)?;
    clear_log_best_effort(repo_path);
    Ok(())
}
