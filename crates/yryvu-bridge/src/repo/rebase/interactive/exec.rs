// SPDX-License-Identifier: AGPL-3.0-or-later

//! Custom interactive-rebase orchestrator built on libgit2 primitives.
//! libgit2 has no `git-rebase-todo` editor, so we apply the plan
//! ourselves: detach HEAD onto the target, then walk the plan running
//! cherry-pick / amend / drop per step (see [`super::steps`]). State is
//! persisted under `.git/yryvu-rebase-state.json` (see [`super::state_io`])
//! separate from `.git/rebase-merge/` so we don't trip git CLI.

use std::path::Path;

use anyhow::anyhow;
use git2::{Oid, Repository};

use crate::backend::BackendError;

use super::super::super::common::{git2_err, open_git2};
use super::super::super::worktree::is_working_tree_dirty;
use super::plan::{PauseReason, RebaseAction, RebasePlan, RebaseState};
use super::refs::{detach_to, head_commit, move_branch_to};
use super::state_io::{clear_state, load_state, save_state};
use super::steps::{commit_resolved_step, run_pending};

fn validate_plan(repo: &Repository, plan: &RebasePlan) -> Result<Oid, BackendError> {
    if plan.steps.is_empty() {
        return Err(BackendError::Git(anyhow!("rebase plan is empty")));
    }
    if matches!(
        plan.steps[0].action,
        RebaseAction::Squash | RebaseAction::Fixup
    ) {
        return Err(BackendError::Git(anyhow!(
            "first step cannot be squash or fixup"
        )));
    }
    let onto_oid = Oid::from_str(&plan.onto).map_err(git2_err)?;
    repo.find_commit(onto_oid).map_err(git2_err)?;
    for step in &plan.steps {
        let oid = Oid::from_str(&step.oid).map_err(git2_err)?;
        let commit = repo.find_commit(oid).map_err(git2_err)?;
        if commit.parent_count() > 1 && step.action != RebaseAction::Drop {
            return Err(BackendError::Git(anyhow!(
                "step {} is a merge commit; mark it Drop or exclude it",
                &step.oid[..7.min(step.oid.len())]
            )));
        }
        if step.action == RebaseAction::Reword && step.new_message.is_none() {
            return Err(BackendError::Git(anyhow!(
                "reword step {} missing new_message",
                &step.oid[..7.min(step.oid.len())]
            )));
        }
    }
    Ok(onto_oid)
}

/// Public entry point — begin an interactive rebase. Detaches HEAD to
/// `onto` and runs steps until completion, an `Edit` pause, or a
/// conflict pause.
pub fn begin_rebase(repo_path: &Path, plan: RebasePlan) -> Result<RebaseState, BackendError> {
    let repo = open_git2(repo_path)?;
    if load_state(&repo)?.is_some() {
        return Err(BackendError::Git(anyhow!(
            "rebase already in progress; abort or continue it first"
        )));
    }
    validate_plan(&repo, &plan)?;

    let head = repo.head().map_err(git2_err)?;
    if !head.is_branch() {
        return Err(BackendError::Git(anyhow!(
            "HEAD is detached; check out a branch before rebasing"
        )));
    }
    let branch_full = head.name().unwrap_or("HEAD").to_string();
    let original_head = head.peel_to_commit().map_err(git2_err)?.id().to_string();

    // Pre-flight, mirroring `cherry_pick_commits_onto`: `detach_to` force-
    // checks-out, which overwrites uncommitted work instead of refusing.
    // That content was never a git object, so unlike a clobbered commit it
    // is recoverable from nowhere — not the ODB, not the reflog, not a
    // stash. Git refuses to rebase a dirty tree for the same reason. The
    // typed error lets the frontend offer the auto-stash path it already
    // uses for `Checkout this commit`.
    if is_working_tree_dirty(repo_path)? {
        return Err(BackendError::WorkingTreeDirty);
    }

    detach_to(
        &repo,
        Oid::from_str(&plan.onto).map_err(git2_err)?,
        "yryvu: interactive rebase begin",
    )?;

    let mut state = RebaseState {
        onto: plan.onto,
        steps: plan.steps,
        current_step: 0,
        original_head,
        head_branch: Some(branch_full),
        pause_reason: None,
    };
    run_pending(&repo, &mut state)?;
    finalise_or_save(&repo, state)
}

/// Continue after a pause. Caller is responsible for ensuring the
/// index has no conflicts (for `Conflict` pauses) before invoking.
pub fn continue_rebase(repo_path: &Path) -> Result<RebaseState, BackendError> {
    let repo = open_git2(repo_path)?;
    let mut state =
        load_state(&repo)?.ok_or_else(|| BackendError::Git(anyhow!("no rebase in progress")))?;
    let Some(reason) = state.pause_reason.take() else {
        return Err(BackendError::Git(anyhow!("rebase is not paused")));
    };

    match reason {
        PauseReason::Conflict => {
            let step = state.steps[state.current_step].clone();
            let mut index = repo.index().map_err(git2_err)?;
            if index.has_conflicts() {
                state.pause_reason = Some(PauseReason::Conflict);
                save_state(&repo, &state)?;
                return Err(BackendError::Git(anyhow!(
                    "conflicts remain in the index; resolve and stage before continuing"
                )));
            }
            let tree_oid = index.write_tree().map_err(git2_err)?;
            let tree = repo.find_tree(tree_oid).map_err(git2_err)?;
            commit_resolved_step(&repo, &step, &tree)?;
        }
        PauseReason::Edit => {
            // The whole point of `edit` is to fold the user's changes into
            // the step's commit before advancing. The commit already exists
            // as HEAD (created eagerly in `apply_pick`), so this is an amend,
            // not a fresh commit — mirroring `git rebase --continue` after an
            // `edit` stop, which runs `git commit --amend` over the staged
            // tree.
            //
            // Fidelity to git, deliberately chosen over auto-staging: only
            // the INDEX is committed. Unstaged changes abort (they are never
            // discarded) so a half-staged edit can't silently lose the rest;
            // the yryvu staging panel is on screen during the pause. A clean
            // index (nothing staged) is a no-op — re-amending with a fresh
            // committer would only churn the SHA.
            let unstaged = repo
                .diff_index_to_workdir(None, None)
                .map_err(git2_err)?
                .deltas()
                .len();
            if unstaged > 0 {
                state.pause_reason = Some(PauseReason::Edit);
                save_state(&repo, &state)?;
                return Err(BackendError::Git(anyhow!(
                    "you have unstaged changes; stage or discard them before continuing"
                )));
            }
            let mut index = repo.index().map_err(git2_err)?;
            let tree_oid = index.write_tree().map_err(git2_err)?;
            let head = head_commit(&repo)?;
            if tree_oid != head.tree_id() {
                let tree = repo.find_tree(tree_oid).map_err(git2_err)?;
                let committer = repo.signature().map_err(git2_err)?;
                // author = None preserves the step commit's author; message =
                // None preserves its message; only the tree and committer move.
                head.amend(
                    Some("HEAD"),
                    None,
                    Some(&committer),
                    None,
                    None,
                    Some(&tree),
                )
                .map_err(git2_err)?;
            }
        }
    }
    state.current_step += 1;
    run_pending(&repo, &mut state)?;
    finalise_or_save(&repo, state)
}

/// Drop the current step and continue. Used to recover from a conflict
/// the user cannot resolve.
pub fn skip_step(repo_path: &Path) -> Result<RebaseState, BackendError> {
    let repo = open_git2(repo_path)?;
    let mut state =
        load_state(&repo)?.ok_or_else(|| BackendError::Git(anyhow!("no rebase in progress")))?;
    if state.pause_reason.is_none() {
        return Err(BackendError::Git(anyhow!("rebase is not paused")));
    }
    let _ = repo.cleanup_state();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).map_err(git2_err)?;
    state.pause_reason = None;
    state.current_step += 1;
    run_pending(&repo, &mut state)?;
    finalise_or_save(&repo, state)
}

/// Abort an in-progress rebase. Resets HEAD (and the original branch
/// if any) back to `original_head` and removes the state file.
pub fn abort_rebase(repo_path: &Path) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let state =
        load_state(&repo)?.ok_or_else(|| BackendError::Git(anyhow!("no rebase in progress")))?;
    let original = Oid::from_str(&state.original_head).map_err(git2_err)?;
    let _ = repo.cleanup_state();
    match state.head_branch.as_deref() {
        Some(branch_full) => {
            move_branch_to(&repo, branch_full, original, "yryvu: rebase abort")?;
        }
        None => {
            detach_to(&repo, original, "yryvu: rebase abort")?;
        }
    }
    clear_state(&repo)?;
    Ok(())
}

/// Read the persisted state (`None` when no rebase is in progress).
pub fn get_state(repo_path: &Path) -> Result<Option<RebaseState>, BackendError> {
    let repo = open_git2(repo_path)?;
    load_state(&repo)
}

/// If the plan completed, restore the original branch ref to point at
/// HEAD and clear state. Otherwise persist the state and return it.
fn finalise_or_save(repo: &Repository, state: RebaseState) -> Result<RebaseState, BackendError> {
    if state.current_step < state.steps.len() {
        save_state(repo, &state)?;
        return Ok(state);
    }
    let final_oid = head_commit(repo)?.id();
    if let Some(branch_full) = state.head_branch.as_deref() {
        move_branch_to(repo, branch_full, final_oid, "yryvu: rebase finish")?;
    }
    clear_state(repo)?;
    Ok(state)
}
