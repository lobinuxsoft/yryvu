// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::Context;
use graph_core::{Commit, RefTag};

use crate::backend::{BackendError, CommitDiff};

use super::common::{diff_to_file_diffs, git2_err, open_git2, open_repo};

pub fn walk_commits(
    repo_path: &Path,
) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
    let repo = open_repo(repo_path)?;

    let head_id = repo
        .head_id()
        .context("resolve HEAD")
        .map_err(BackendError::Revwalk)?;

    let walk = repo
        .rev_walk(Some(head_id))
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .context("start revwalk")
        .map_err(BackendError::Revwalk)?;

    // Collect eagerly for a first cut. Streaming via Tauri events happens at the
    // commands layer — this iterator feeds into the lane assigner synchronously.
    let mut commits = Vec::new();
    for info in walk {
        let info = info.map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        let gix_commit = repo
            .find_commit(info.id)
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;

        let author = gix_commit
            .author()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        let time = gix_commit
            .time()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        let message = gix_commit
            .message()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;

        let parents: Vec<String> = gix_commit.parent_ids().map(|id| id.to_string()).collect();

        let author_line = format!("{} <{}>", author.name, author.email);
        let summary = message.summary().to_string();

        commits.push(Ok(Commit {
            sha: info.id.to_string(),
            parents,
            summary,
            author: author_line,
            author_date: time.seconds,
            refs: Vec::<RefTag>::new(),
        }));
    }

    Ok(Box::new(commits.into_iter()))
}

pub fn commit_diff(repo_path: &Path, sha: &str) -> Result<CommitDiff, BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(git2_err)?;
    let commit = repo.find_commit(oid).map_err(git2_err)?;

    let parent_tree = if commit.parent_count() > 0 {
        Some(
            commit
                .parent(0)
                .map_err(git2_err)?
                .tree()
                .map_err(git2_err)?,
        )
    } else {
        None
    };
    let tree = commit.tree().map_err(git2_err)?;

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.include_typechange(true).context_lines(3);

    let mut diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut diff_opts))
        .map_err(git2_err)?;

    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true).copies(true);
    diff.find_similar(Some(&mut find_opts)).map_err(git2_err)?;

    let files = diff_to_file_diffs(&diff)?;

    let parent_sha = if commit.parent_count() > 0 {
        commit.parent_id(0).ok().map(|id| id.to_string())
    } else {
        None
    };

    Ok(CommitDiff {
        sha: sha.to_string(),
        parent_sha,
        files,
    })
}
