// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;

use super::super::common::{git2_err, open_git2};
use super::types::CommitOptions;

/// Compose the final commit message from `summary` + optional `description`
/// with a blank-line separator. Strips trailing whitespace off each side;
/// returns `None` if the summary is empty after trimming.
fn compose_message(summary: &str, description: &str) -> Option<String> {
    let summary = summary.trim();
    if summary.is_empty() {
        return None;
    }
    let description = description.trim();
    if description.is_empty() {
        Some(summary.to_string())
    } else {
        Some(format!("{summary}\n\n{description}"))
    }
}

/// Write a new commit (or amend HEAD) with the bundled options. Replaces
/// the pair `commit_staged` / `amend_commit` — both kept as thin wrappers
/// below for call sites that don't care about description / flags.
///
/// BACKEND: git2 — needs `index.write_tree()` to materialise the staged
/// tree before the commit object. gix 0.68 / gix-index 0.37 read the
/// index but don't expose a state→tree writer yet. Migrate to
/// `gix::Repository::commit_as()` once gix-index gains a `write_tree`
/// equivalent.
pub fn create_commit(repo_path: &Path, opts: &CommitOptions) -> Result<String, BackendError> {
    let message = compose_message(&opts.summary, &opts.description)
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("commit message cannot be empty")))?;

    if opts.gpg_sign {
        return Err(BackendError::NotImplemented("gpg commit signing"));
    }

    let repo = open_git2(repo_path)?;
    let signature = repo.signature().map_err(git2_err)?;

    let mut index = repo.index().map_err(git2_err)?;
    let tree_oid = index.write_tree().map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;

    if opts.amend {
        let head = repo
            .head()
            .map_err(|_| BackendError::Git(anyhow::anyhow!("cannot amend: no HEAD commit")))?;
        let head_commit = head.peel_to_commit().map_err(git2_err)?;
        let old_sha = head_commit.id().to_string();

        let new_oid = head_commit
            .amend(
                Some("HEAD"),
                None,
                Some(&signature),
                None,
                Some(&message),
                Some(&tree),
            )
            .map_err(git2_err)?;
        let new_sha = new_oid.to_string();
        crate::undo_log::record_op_best_effort(
            repo_path,
            crate::undo_log::OpKind::Amend {
                old_sha,
                new_sha: new_sha.clone(),
            },
        );
        return Ok(new_sha);
    }

    let parents: Vec<git2::Commit> = match repo.head().ok() {
        Some(head) => {
            let commit = head.peel_to_commit().map_err(git2_err)?;
            vec![commit]
        }
        None => Vec::new(),
    };
    let parent_sha = parents.first().map(|c| c.id().to_string());
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let new_oid = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parent_refs,
        )
        .map_err(git2_err)?;
    let new_sha = new_oid.to_string();

    crate::undo_log::record_op_best_effort(
        repo_path,
        crate::undo_log::OpKind::Commit {
            sha: new_sha.clone(),
            parent_sha,
        },
    );

    Ok(new_sha)
}

pub fn commit_staged(repo_path: &Path, message: &str) -> Result<String, BackendError> {
    create_commit(
        repo_path,
        &CommitOptions {
            summary: message.to_string(),
            ..CommitOptions::default()
        },
    )
}

pub fn amend_commit(repo_path: &Path, message: &str) -> Result<String, BackendError> {
    create_commit(
        repo_path,
        &CommitOptions {
            summary: message.to_string(),
            amend: true,
            ..CommitOptions::default()
        },
    )
}

/// GitKraken's one-shot `Commit and Push`: write the commit, then push
/// HEAD's branch to its upstream. The commit is already durable if the
/// push fails, so the caller can retry the push alone.
///
/// BACKEND: git2 (transitively) — see `create_commit` and
/// `push_current_branch` for individual migration blockers.
pub fn commit_and_push(repo_path: &Path, opts: &CommitOptions) -> Result<String, BackendError> {
    let new_sha = create_commit(repo_path, opts)?;
    super::super::remote::push_current_branch(repo_path, crate::backend::PushOptions::default())?;
    Ok(new_sha)
}

pub fn head_commit_message(repo_path: &Path) -> Result<String, BackendError> {
    let repo = open_git2(repo_path)?;
    let head = repo
        .head()
        .map_err(|_| BackendError::Git(anyhow::anyhow!("no HEAD commit")))?;
    let head_commit = head.peel_to_commit().map_err(git2_err)?;
    Ok(head_commit.message().unwrap_or_default().to_string())
}
