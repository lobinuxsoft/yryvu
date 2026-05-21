// SPDX-License-Identifier: AGPL-3.0-or-later

//! Custom interactive-rebase orchestrator built on libgit2 primitives.
//! libgit2 has no `git-rebase-todo` editor, so we apply the plan
//! ourselves: detach HEAD onto the target, then walk the plan running
//! cherry-pick / amend / drop per step. State is persisted under
//! `.git/yryvu-rebase-state.json` (separate from `.git/rebase-merge/`
//! so we don't trip git CLI).

use std::path::{Path, PathBuf};

use anyhow::anyhow;
use git2::{Commit, Oid, Repository};

use crate::backend::BackendError;

use super::super::super::common::{git2_err, open_git2};
use super::plan::{PauseReason, RebaseAction, RebasePlan, RebaseState, RebaseStep};

const STATE_FILE: &str = "yryvu-rebase-state.json";

fn state_path(repo: &Repository) -> PathBuf {
    repo.path().join(STATE_FILE)
}

fn load_state(repo: &Repository) -> Result<Option<RebaseState>, BackendError> {
    let path = state_path(repo);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| BackendError::Git(anyhow!(e)))?;
    let state: RebaseState =
        serde_json::from_slice(&bytes).map_err(|e| BackendError::Git(anyhow!(e)))?;
    Ok(Some(state))
}

fn save_state(repo: &Repository, state: &RebaseState) -> Result<(), BackendError> {
    let path = state_path(repo);
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| BackendError::Git(anyhow!(e)))?;
    std::fs::write(&path, bytes).map_err(|e| BackendError::Git(anyhow!(e)))?;
    Ok(())
}

fn clear_state(repo: &Repository) -> Result<(), BackendError> {
    let path = state_path(repo);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| BackendError::Git(anyhow!(e)))?;
    }
    Ok(())
}

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

fn head_commit(repo: &Repository) -> Result<Commit<'_>, BackendError> {
    repo.head()
        .and_then(|h| h.peel_to_commit())
        .map_err(git2_err)
}

fn detach_to(repo: &Repository, oid: Oid, msg: &str) -> Result<(), BackendError> {
    repo.set_head_detached(oid).map_err(git2_err)?;
    repo.reference("HEAD", oid, true, msg).map_err(git2_err)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).map_err(git2_err)?;
    Ok(())
}

fn move_branch_to(
    repo: &Repository,
    branch_full: &str,
    oid: Oid,
    msg: &str,
) -> Result<(), BackendError> {
    repo.reference(branch_full, oid, true, msg)
        .map_err(git2_err)?;
    repo.set_head(branch_full).map_err(git2_err)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).map_err(git2_err)?;
    Ok(())
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
        PauseReason::Edit => { /* commit already exists; just advance */ }
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

/// Drive steps starting at `state.current_step` until completion, an
/// `Edit` pause, or a conflict. Mutates `state.current_step` and
/// `state.pause_reason` in place.
fn run_pending(repo: &Repository, state: &mut RebaseState) -> Result<(), BackendError> {
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
fn commit_resolved_step(
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
