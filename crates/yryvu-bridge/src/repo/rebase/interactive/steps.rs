// SPDX-License-Identifier: AGPL-3.0-or-later

//! The plan-walking runtime: cherry-pick / amend / drop, one step at a
//! time. `run_pending` drives the cursor until completion, an `Edit`
//! pause, or a conflict; the per-action helpers do the git work.

use git2::{Commit, Oid, Repository};

use crate::backend::BackendError;

use super::super::super::common::git2_err;
use super::plan::{PauseReason, RebaseAction, RebaseState, RebaseStep};
use super::refs::head_commit;

/// Drive steps starting at `state.current_step` until completion, an
/// `Edit` pause, or a conflict. Mutates `state.current_step` and
/// `state.pause_reason` in place.
pub(super) fn run_pending(repo: &Repository, state: &mut RebaseState) -> Result<(), BackendError> {
    while state.current_step < state.steps.len() {
        let step = state.steps[state.current_step].clone();
        match step.action {
            RebaseAction::Drop => {
                state.current_step += 1;
            }
            RebaseAction::Pick | RebaseAction::Reword | RebaseAction::Edit => {
                let conflicted = apply_pick(repo, &step)?;
                if conflicted {
                    state.pause_reason = Some(PauseReason::Conflict);
                    return Ok(());
                }
                if step.action == RebaseAction::Edit {
                    state.pause_reason = Some(PauseReason::Edit);
                    return Ok(());
                }
                state.current_step += 1;
            }
            RebaseAction::Squash | RebaseAction::Fixup => {
                let conflicted = apply_squash(repo, &step)?;
                if conflicted {
                    state.pause_reason = Some(PauseReason::Conflict);
                    return Ok(());
                }
                state.current_step += 1;
            }
        }
    }
    Ok(())
}

/// Cherry-pick the step's commit onto HEAD and create a new commit.
/// Returns `true` if the cherry-pick produced index conflicts (in
/// which case no commit is made and the caller must pause).
fn apply_pick(repo: &Repository, step: &RebaseStep) -> Result<bool, BackendError> {
    let oid = Oid::from_str(&step.oid).map_err(git2_err)?;
    let source = repo.find_commit(oid).map_err(git2_err)?;
    repo.cherrypick(&source, None).map_err(git2_err)?;
    let mut index = repo.index().map_err(git2_err)?;
    if index.has_conflicts() {
        return Ok(true);
    }
    let tree_oid = index.write_tree().map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;
    commit_resolved_step(repo, step, &tree)?;
    Ok(false)
}

/// Cherry-pick + amend into the previous HEAD commit. `Squash` joins
/// messages with a blank-line separator; `Fixup` keeps the previous
/// message untouched.
fn apply_squash(repo: &Repository, step: &RebaseStep) -> Result<bool, BackendError> {
    let oid = Oid::from_str(&step.oid).map_err(git2_err)?;
    let source = repo.find_commit(oid).map_err(git2_err)?;
    repo.cherrypick(&source, None).map_err(git2_err)?;
    let mut index = repo.index().map_err(git2_err)?;
    if index.has_conflicts() {
        return Ok(true);
    }
    let tree_oid = index.write_tree().map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;

    let head = head_commit(repo)?;
    let head_msg = head.message().unwrap_or("").to_string();
    let new_msg = if step.action == RebaseAction::Squash {
        let src_msg = source.message().unwrap_or("");
        format!("{}\n\n{}", head_msg.trim_end(), src_msg.trim())
    } else {
        head_msg
    };
    let signature = repo.signature().map_err(git2_err)?;
    head.amend(
        Some("HEAD"),
        Some(&signature),
        Some(&signature),
        None,
        Some(&new_msg),
        Some(&tree),
    )
    .map_err(git2_err)?;
    repo.cleanup_state().map_err(git2_err)?;
    Ok(false)
}

/// Write a new commit with the step's metadata. Used by both the
/// happy-path (`apply_pick`) and the resume-after-conflict path
/// (`continue_rebase`).
pub(super) fn commit_resolved_step(
    repo: &Repository,
    step: &RebaseStep,
    tree: &git2::Tree<'_>,
) -> Result<(), BackendError> {
    let oid = Oid::from_str(&step.oid).map_err(git2_err)?;
    let source = repo.find_commit(oid).map_err(git2_err)?;
    let signature = repo.signature().map_err(git2_err)?;
    let message = match step.action {
        RebaseAction::Reword => step.new_message.clone().unwrap_or_default(),
        _ => source.message().unwrap_or("").to_string(),
    };
    let head = head_commit(repo)?;
    let parents: Vec<Commit<'_>> = vec![head];
    let parent_refs: Vec<&Commit<'_>> = parents.iter().collect();
    repo.commit(
        Some("HEAD"),
        &source.author(),
        &signature,
        &message,
        tree,
        &parent_refs,
    )
    .map_err(git2_err)?;
    repo.cleanup_state().map_err(git2_err)?;
    Ok(())
}
