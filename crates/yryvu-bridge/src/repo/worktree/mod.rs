// SPDX-License-Identifier: AGPL-3.0-or-later

//! Working-tree mutating operations: checkout (branch / remote / commit),
//! reset, cherry-pick, revert, stash, merge abort, and repo-state probe.
//!
//! Despite the name, this module is **not** about `git worktree` (the
//! multi-checkout feature) — those operations live elsewhere. The name
//! reflects the shared property of every fn here: each one mutates the
//! working tree in some way, so the UI tends to gate them on the same
//! "working tree clean?" check.

mod checkout;
mod cherry_pick;
mod repo_state;
mod reset;
mod revert;
mod stash;

pub use checkout::{
    checkout_branch, checkout_commit, checkout_remote_tracking, is_working_tree_dirty,
};
pub use cherry_pick::cherry_pick_commit;
pub use repo_state::{abort_merge, repo_state};
pub use reset::reset_to_commit;
pub use revert::revert_commit;
pub use stash::{stash_apply, stash_count, stash_drop, stash_pop, stash_pop_at, stash_push};

/// Snapshot of "where HEAD is right now" for the undo log. Returns the
/// branch shorthand for an attached HEAD, the commit SHA for a detached
/// one, or `None` for an unborn branch (no commits yet — checkout from
/// nowhere isn't undoable).
pub(super) fn current_head_label(repo: &git2::Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if head.is_branch() {
        head.shorthand().map(|s| s.to_string())
    } else {
        head.peel_to_commit().ok().map(|c| c.id().to_string())
    }
}
