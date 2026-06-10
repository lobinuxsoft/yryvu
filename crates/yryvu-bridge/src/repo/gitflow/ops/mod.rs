// SPDX-License-Identifier: AGPL-3.0-or-later

//! Git Flow + GitHub Flow branch operations (issue #19).
//!
//! GitKraken reimplements these on top of libgit2 rather than shelling
//! out to the `git flow` CLI; yryvu does the same so the workflow works
//! without the external tool installed. Each operation is plain
//! orchestration over existing backend primitives:
//!
//! - `*_start` — create a topic branch off the right base, then check
//!   it out.
//! - `*_finish` — no-fast-forward merge back into the integration (and,
//!   for release / hotfix, the production) branch, optionally tag the
//!   production tip, optionally delete the topic branch.
//!
//! The `--no-ff` policy is mandatory: gitflow's whole value is the
//! explicit merge bubble in history, so every finish forces a merge
//! commit even when a fast-forward would be possible
//! ([`MergeStrategy::NoFastForward`]). This satisfies the issue's
//! "no-ff merges preserved correctly" acceptance criterion.
//!
//! GitHub Flow needs no `[gitflow]` config — it is just "branch off the
//! base, merge back, delete" — so its two ops take the base branch
//! explicitly instead of reading the config.

use std::path::Path;

use serde::Serialize;

use super::{read_gitflow_config, GitflowConfig, GitflowError};
use crate::backend::{BackendError, MergeResult, MergeStrategy};
use crate::repo::{branches, merge, tags, worktree};

/// Outcome of a `finish` operation. A finish runs a sequence of merges;
/// if one hits conflicts we stop and report which step halted so the UI
/// can route the user to the conflict resolver. The repo is left
/// merge-in-progress (exactly as a manual `git merge` would), and the
/// `StateBanner` surfaces the abort / resolve affordance.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FinishOutcome {
    /// Every merge applied cleanly. `tag` is the tag created on the
    /// production branch (release / hotfix only; `None` otherwise).
    Completed { tag: Option<String> },
    /// A merge halted on conflicts at `step`. `tag`, when present, was
    /// already created before the conflicting step ran.
    Conflict {
        paths: Vec<String>,
        step: String,
        tag: Option<String>,
    },
}

fn config(repo_path: &Path) -> Result<GitflowConfig, GitflowError> {
    read_gitflow_config(repo_path)?.ok_or(GitflowError::NotInitialised)
}

/// No-ff merge `source` into the currently checked-out branch. Returns
/// the conflicting paths when the merge halts, `None` on a clean
/// merge / fast-forward-as-merge / already-up-to-date.
fn merge_no_ff(repo_path: &Path, source: &str) -> Result<Option<Vec<String>>, BackendError> {
    match merge::merge_branch(repo_path, source, MergeStrategy::NoFastForward)? {
        MergeResult::Conflict { paths } => Ok(Some(paths)),
        _ => Ok(None),
    }
}

/// Resolve a branch name to its tip commit sha (used to place the tag
/// after merging into production).
fn branch_tip(repo_path: &Path, branch: &str) -> Result<String, BackendError> {
    let repo = git2::Repository::open(repo_path).map_err(|e| BackendError::Git(e.into()))?;
    let oid = repo
        .revparse_single(branch)
        .map_err(|e| BackendError::Git(e.into()))?
        .peel_to_commit()
        .map_err(|e| BackendError::Git(e.into()))?
        .id();
    Ok(oid.to_string())
}

/// Create `{prefix}{name}` off `base` and check it out.
fn start_topic(
    repo_path: &Path,
    prefix: &str,
    name: &str,
    base: &str,
) -> Result<String, GitflowError> {
    let branch = format!("{prefix}{name}");
    branches::create_branch(repo_path, &branch, Some(base))?;
    worktree::checkout_branch(repo_path, &branch)?;
    Ok(branch)
}

// ---- feature ----

pub fn feature_start(repo_path: &Path, name: &str) -> Result<String, GitflowError> {
    let cfg = config(repo_path)?;
    start_topic(repo_path, &cfg.feature_prefix, name, &cfg.develop_branch)
}

/// Finish a feature: no-ff merge into develop, then drop the branch.
/// Features never tag and never touch production.
pub fn feature_finish(
    repo_path: &Path,
    name: &str,
    keep_branch: bool,
) -> Result<FinishOutcome, GitflowError> {
    let cfg = config(repo_path)?;
    let branch = format!("{}{}", cfg.feature_prefix, name);
    finish_into_integration(repo_path, &cfg.develop_branch, &branch, keep_branch)
}

// ---- release ----

pub fn release_start(repo_path: &Path, version: &str) -> Result<String, GitflowError> {
    let cfg = config(repo_path)?;
    start_topic(repo_path, &cfg.release_prefix, version, &cfg.develop_branch)
}

pub fn release_finish(
    repo_path: &Path,
    version: &str,
    tag_message: &str,
    keep_branch: bool,
) -> Result<FinishOutcome, GitflowError> {
    let cfg = config(repo_path)?;
    let branch = format!("{}{}", cfg.release_prefix, version);
    finish_into_production(repo_path, &cfg, &branch, version, tag_message, keep_branch)
}

// ---- hotfix ----

pub fn hotfix_start(repo_path: &Path, version: &str) -> Result<String, GitflowError> {
    let cfg = config(repo_path)?;
    // Hotfixes branch off production, not develop.
    start_topic(repo_path, &cfg.hotfix_prefix, version, &cfg.master_branch)
}

pub fn hotfix_finish(
    repo_path: &Path,
    version: &str,
    tag_message: &str,
    keep_branch: bool,
) -> Result<FinishOutcome, GitflowError> {
    let cfg = config(repo_path)?;
    let branch = format!("{}{}", cfg.hotfix_prefix, version);
    finish_into_production(repo_path, &cfg, &branch, version, tag_message, keep_branch)
}

// ---- GitHub Flow ----

/// GitHub Flow: a short-lived branch off the production/default branch.
/// No prefix, no config — `name` is the full branch name.
pub fn github_flow_start(repo_path: &Path, base: &str, name: &str) -> Result<String, GitflowError> {
    branches::create_branch(repo_path, name, Some(base))?;
    worktree::checkout_branch(repo_path, name)?;
    Ok(name.to_string())
}

/// GitHub Flow finish: no-ff merge back into `base`, then drop the
/// branch. No production/develop split, no tag.
pub fn github_flow_finish(
    repo_path: &Path,
    base: &str,
    name: &str,
    keep_branch: bool,
) -> Result<FinishOutcome, GitflowError> {
    finish_into_integration(repo_path, base, name, keep_branch)
}

// ---- shared finish bodies ----

/// Single-target finish (feature / GitHub Flow): merge the topic branch
/// into `integration` and optionally delete it.
fn finish_into_integration(
    repo_path: &Path,
    integration: &str,
    branch: &str,
    keep_branch: bool,
) -> Result<FinishOutcome, GitflowError> {
    worktree::checkout_branch(repo_path, integration)?;
    if let Some(paths) = merge_no_ff(repo_path, branch)? {
        return Ok(FinishOutcome::Conflict {
            paths,
            step: format!("merge into {integration}"),
            tag: None,
        });
    }
    if !keep_branch {
        branches::delete_local_branch(repo_path, branch, true)?;
    }
    Ok(FinishOutcome::Completed { tag: None })
}

/// Two-target finish (release / hotfix): merge into production, tag the
/// production tip, merge into develop, then optionally delete. Mirrors
/// `git flow release finish`. A conflict at any merge halts the sequence
/// and reports the step; a tag created before the halt is preserved in
/// the outcome so the UI can report it.
fn finish_into_production(
    repo_path: &Path,
    cfg: &GitflowConfig,
    branch: &str,
    version: &str,
    tag_message: &str,
    keep_branch: bool,
) -> Result<FinishOutcome, GitflowError> {
    // 1. Merge into production.
    worktree::checkout_branch(repo_path, &cfg.master_branch)?;
    if let Some(paths) = merge_no_ff(repo_path, branch)? {
        return Ok(FinishOutcome::Conflict {
            paths,
            step: format!("merge into {}", cfg.master_branch),
            tag: None,
        });
    }

    // 2. Tag the production tip (empty message => lightweight tag).
    let tag_name = format!("{}{}", cfg.version_tag_prefix, version);
    let tip = branch_tip(repo_path, &cfg.master_branch)?;
    let message = (!tag_message.trim().is_empty()).then_some(tag_message);
    tags::create_tag(repo_path, &tag_name, &tip, message)?;

    // 3. Merge into develop.
    worktree::checkout_branch(repo_path, &cfg.develop_branch)?;
    if let Some(paths) = merge_no_ff(repo_path, branch)? {
        return Ok(FinishOutcome::Conflict {
            paths,
            step: format!("merge into {}", cfg.develop_branch),
            tag: Some(tag_name),
        });
    }

    // 4. Drop the topic branch.
    if !keep_branch {
        branches::delete_local_branch(repo_path, branch, true)?;
    }
    Ok(FinishOutcome::Completed {
        tag: Some(tag_name),
    })
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
