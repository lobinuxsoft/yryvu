// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::{BackendError, CommitDetail};

use super::super::common::open_repo;

/// Resolve full metadata for a single commit.
///
/// Powers the right-panel inspector (issue #112). Reads the commit object
/// fresh from the repo rather than from a cached `GraphRow` so the inspector
/// still resolves when the commit is outside the current stream window.
pub fn commit_details(repo_path: &Path, sha: &str) -> Result<CommitDetail, BackendError> {
    let repo = open_repo(repo_path)?;
    let oid = gix::ObjectId::from_hex(sha.as_bytes())
        .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
    let gix_commit = repo
        .find_commit(oid)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;

    let author = gix_commit
        .author()
        .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
    let committer = gix_commit.committer().ok();
    let message = gix_commit
        .message()
        .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;

    let parent_shas: Vec<String> = gix_commit.parent_ids().map(|id| id.to_string()).collect();

    let author_name = author.name.to_string();
    let author_email = author.email.to_string();
    let author_date = author.time.seconds;
    let summary = message.summary().to_string();
    let body = message.body.map(|b| b.to_string()).unwrap_or_default();
    let author_initials = graph_core::author_initials(&author_name, &author_email);
    let gravatar_hash = graph_core::gravatar_hash(&author_email);

    let (
        committer_name,
        committer_email,
        committer_date,
        committer_initials,
        committer_gravatar_hash,
    ) = match committer {
        Some(c) => {
            let name = c.name.to_string();
            let email = c.email.to_string();
            let initials = graph_core::author_initials(&name, &email);
            let hash = graph_core::gravatar_hash(&email);
            (
                Some(name),
                Some(email),
                Some(c.time.seconds),
                Some(initials),
                Some(hash),
            )
        }
        None => (None, None, None, None, None),
    };

    let short_sha: String = sha.chars().take(6).collect();

    Ok(CommitDetail {
        sha: sha.to_string(),
        short_sha,
        parent_shas,
        summary,
        body,
        author_name,
        author_email,
        author_date,
        author_initials,
        gravatar_hash,
        committer_name,
        committer_email,
        committer_date,
        committer_initials,
        committer_gravatar_hash,
    })
}
