// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2};
use crate::undo_log::{record_op_best_effort, OpKind};

pub fn stash_push(repo_path: &Path, message: Option<&str>) -> Result<(), BackendError> {
    let mut repo = open_git2(repo_path)?;
    let signature = repo.signature().map_err(git2_err)?;
    let flags = git2::StashFlags::DEFAULT | git2::StashFlags::INCLUDE_UNTRACKED;
    let stash_oid = repo
        .stash_save2(&signature, message, Some(flags))
        .map_err(git2_err)?;
    record_op_best_effort(
        repo_path,
        OpKind::StashPush {
            stash_sha: stash_oid.to_string(),
        },
    );
    Ok(())
}

/// Pop the top of the stash queue. Equivalent to `git stash pop` /
/// `git stash pop --index 0`. Used by the toolbar Pop button.
pub fn stash_pop(repo_path: &Path) -> Result<(), BackendError> {
    stash_pop_at(repo_path, 0)
}

/// Pop a specific entry from the stash queue. Equivalent to `git stash
/// pop stash@{index}` — applies the stash to the working tree AND
/// removes it from the queue.
///
/// **Clears the undo log on success.** The pop mutates the working
/// tree in a way that invalidates the preconditions of every prior
/// recorded op — Cmd+Z after a pop would try to reverse a step whose
/// state no longer holds. Wiping the log keeps the undo history
/// honest. (See `undo.rs:22` for why pop itself isn't reversible.)
pub fn stash_pop_at(repo_path: &Path, index: usize) -> Result<(), BackendError> {
    let mut repo = open_git2(repo_path)?;
    repo.stash_pop(index, None).map_err(git2_err)?;
    crate::undo_log::clear_log_best_effort(repo_path);
    Ok(())
}

/// Apply a stash entry to the working tree WITHOUT removing it from
/// the queue. Equivalent to `git stash apply stash@{index}`.
///
/// **Clears the undo log on success.** Apply overwrites working-tree
/// state too — the same staleness argument as `stash_pop_at` applies.
pub fn stash_apply(repo_path: &Path, index: usize) -> Result<(), BackendError> {
    let mut repo = open_git2(repo_path)?;
    repo.stash_apply(index, None).map_err(git2_err)?;
    crate::undo_log::clear_log_best_effort(repo_path);
    Ok(())
}

/// Drop a stash entry without applying it. Equivalent to `git stash
/// drop stash@{index}`.
///
/// **Clears the undo log on success.** Drop is the lightest of the
/// three — it doesn't touch the working tree — but earlier recorded
/// ops may have referenced the stash sha (e.g. a `StashPush` whose
/// undo is "drop the stash"). Wiping keeps the log coherent.
///
/// The dropped sha still lives in the git objects DB until GC
/// (~90 days), so a determined user can `git stash apply <sha>` from
/// a terminal.
pub fn stash_drop(repo_path: &Path, index: usize) -> Result<(), BackendError> {
    let mut repo = open_git2(repo_path)?;
    repo.stash_drop(index).map_err(git2_err)?;
    crate::undo_log::clear_log_best_effort(repo_path);
    Ok(())
}

/// Count the entries in the stash queue. The toolbar's Pop button gates
/// on this to avoid the libgit2 `reference 'refs/stash' not found`
/// error that fires when popping with an empty queue.
pub fn stash_count(repo_path: &Path) -> Result<u32, BackendError> {
    let mut repo = open_git2(repo_path)?;
    let mut count: u32 = 0;
    repo.stash_foreach(|_index, _message, _oid| {
        count += 1;
        true
    })
    .map_err(git2_err)?;
    Ok(count)
}
