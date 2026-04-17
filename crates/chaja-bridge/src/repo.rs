// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::Context;
use graph_core::{Commit, RefTag};

use crate::backend::{BackendError, GitBackend};

#[derive(Debug, Default, Clone, Copy)]
pub struct GixBackend;

impl GitBackend for GixBackend {
    fn walk_commits(
        &self,
        repo_path: &Path,
    ) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
        let repo = gix::open(repo_path).map_err(|e| BackendError::Open {
            path: repo_path.display().to_string(),
            source: anyhow::Error::new(e),
        })?;

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
}
