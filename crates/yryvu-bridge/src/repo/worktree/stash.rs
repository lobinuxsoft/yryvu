// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2};
use crate::undo_log::{record_op_best_effort, OpKind};

pub fn stash_push(
    repo_path: &Path,
    message: Option<&str>,
    include_untracked: bool,
    include_ignored: bool,
) -> Result<(), BackendError> {
    let mut repo = open_git2(repo_path)?;
    let signature = repo.signature().map_err(git2_err)?;
    let mut flags = git2::StashFlags::DEFAULT;
    if include_untracked {
        flags |= git2::StashFlags::INCLUDE_UNTRACKED;
    }
    if include_ignored {
        flags |= git2::StashFlags::INCLUDE_IGNORED;
    }
    let stash_oid = repo
        .stash_save2(&signature, message, Some(flags))
        .map_err(git2_err)?;
    record_op_best_effort(
        repo_path,
        OpKind::StashPush {
            stash_sha: stash_oid.to_string(),
            include_untracked,
            include_ignored,
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

/// The queue index of the stash entry whose commit is `sha`, or `None`
/// if it is no longer queued. `stash@{index}` positions shift as entries
/// are pushed and popped, so a recorded sha must be re-resolved before use.
fn stash_index_of(repo: &mut git2::Repository, sha: &str) -> Result<Option<usize>, BackendError> {
    let mut found = None;
    repo.stash_foreach(|index, _message, oid| {
        if oid.to_string() == sha {
            found = Some(index);
            false // stop walking
        } else {
            true
        }
    })
    .map_err(git2_err)?;
    Ok(found)
}

/// Pop the stash entry whose commit is `sha`, wherever it sits in the
/// queue — not blindly `stash@{0}`. Used by `StashPush` undo so a stash
/// the user pushed on top afterwards is never popped by mistake. Errors
/// with `StashEntryGone` if the entry has already left the queue.
pub fn stash_pop_by_sha(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    let mut repo = open_git2(repo_path)?;
    let index = stash_index_of(&mut repo, sha)?.ok_or_else(|| BackendError::StashEntryGone {
        sha: sha.to_string(),
    })?;
    drop(repo);
    stash_pop_at(repo_path, index)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .args(args)
            .current_dir(repo)
            .status()
            .expect("git")
            .success();
        assert!(ok, "git {args:?} failed");
    }

    /// Repo on `main` with one committed file, so later edits are stashable.
    fn base_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        git(p, &["config", "user.name", "t"]);
        git(p, &["config", "user.email", "t@t"]);
        std::fs::write(p.join("tracked.txt"), "base\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "base"]);
        dir
    }

    fn top_stash_sha(p: &Path) -> String {
        let mut repo = open_git2(p).unwrap();
        let mut sha = None;
        repo.stash_foreach(|index, _m, oid| {
            if index == 0 {
                sha = Some(oid.to_string());
            }
            true
        })
        .unwrap();
        sha.expect("a stash on the queue")
    }

    /// The undo of a stash push must pop the stash it recorded, even when
    /// the user stashed again afterwards — not blindly `stash@{0}` (#471).
    #[test]
    fn pop_by_sha_targets_the_recorded_stash_not_the_top() {
        let dir = base_repo();
        let p = dir.path();

        // Stash A: a distinctive tracked edit.
        std::fs::write(p.join("tracked.txt"), "from-A\n").unwrap();
        stash_push(p, Some("A"), true, false).unwrap();
        let sha_a = top_stash_sha(p);

        // Stash B on top.
        std::fs::write(p.join("tracked.txt"), "from-B\n").unwrap();
        stash_push(p, Some("B"), true, false).unwrap();
        let sha_b = top_stash_sha(p);
        assert_ne!(sha_a, sha_b);

        // Undo of the A push must restore A's content and leave B queued.
        stash_pop_by_sha(p, &sha_a).unwrap();
        assert_eq!(
            std::fs::read_to_string(p.join("tracked.txt")).unwrap(),
            "from-A\n",
            "popped the wrong stash — the top (B) instead of the recorded A"
        );
        assert_eq!(stash_count(p).unwrap(), 1, "B should still be queued");
        assert_eq!(top_stash_sha(p), sha_b, "the surviving stash is not B");
    }

    /// If the recorded stash is already gone, refuse rather than pop a
    /// different one.
    #[test]
    fn pop_by_sha_errors_when_the_stash_is_gone() {
        let dir = base_repo();
        let p = dir.path();
        std::fs::write(p.join("tracked.txt"), "edit\n").unwrap();
        stash_push(p, Some("only"), true, false).unwrap();
        let sha = top_stash_sha(p);
        stash_pop_at(p, 0).unwrap(); // drain it

        let err = stash_pop_by_sha(p, &sha).unwrap_err();
        assert!(
            matches!(err, BackendError::StashEntryGone { .. }),
            "expected StashEntryGone, got {err:?}"
        );
    }
}
