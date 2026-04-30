// SPDX-License-Identifier: AGPL-3.0-or-later

//! `list_stashes` — enumerate `refs/stash` entries by walking its
//! reflog, newest-first. Each reflog entry's `new_oid` is one stash
//! commit in the stack (`stash@{0}`, `stash@{1}`, …). For each stash
//! commit we decode the parents to surface the same triple GK exposes:
//!
//!   - `parent_sha`    — the WIP base commit (where HEAD was when stashed).
//!   - `index_sha`     — the index state at stash time (parent 1).
//!   - `untracked_sha` — the untracked-files state (parent 2, present iff
//!                       the stash was taken with `--include-untracked`).
//!
//! `branch_name` is parsed from the stash message (git's canonical
//! formats are `WIP on <branch>: <sha> <subject>` and
//! `On <branch>: <message>`) since the commit object itself doesn't
//! record the source branch.

use std::path::Path;

use anyhow::{anyhow, Context};
use gix::bstr::ByteSlice;

use crate::backend::{BackendError, StashInfo};

use super::common::open_repo;

pub fn list_stashes(repo_path: &Path) -> Result<Vec<StashInfo>, BackendError> {
    let repo = open_repo(repo_path)?;
    let reference = match repo.try_find_reference("refs/stash") {
        Ok(Some(r)) => r,
        Ok(None) => return Ok(Vec::new()),
        Err(e) => return Err(BackendError::Git(anyhow!("open refs/stash: {e}"))),
    };

    let mut log_platform = reference.log_iter();
    let lines = log_platform
        .rev()
        .map_err(|e| BackendError::Git(anyhow!("read refs/stash reflog: {e}")))?;
    let Some(lines) = lines else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for line in lines {
        let line = line.map_err(|e| BackendError::Git(anyhow!("parse reflog line: {e}")))?;
        let oid = line.new_oid;

        let commit = match repo.find_object(oid) {
            Ok(obj) => match obj.try_into_commit() {
                Ok(c) => c,
                Err(_) => continue,
            },
            Err(_) => continue,
        };

        let decoded = commit
            .decode()
            .context("decode stash commit")
            .map_err(BackendError::Git)?;

        let mut parents = decoded.parents();
        let parent_sha = match parents.next() {
            Some(id) => id.to_string(),
            None => continue,
        };
        let index_sha = parents.next().map(|id| id.to_string());
        let untracked_sha = parents.next().map(|id| id.to_string());

        let message = decoded.message.trim().as_bstr().to_string();
        let branch_name = parse_branch_name(&message);
        let when = decoded.committer.time.seconds;

        out.push(StashInfo {
            sha: oid.to_string(),
            message,
            branch_name,
            parent_sha,
            index_sha,
            untracked_sha,
            when,
        });
    }

    Ok(out)
}

/// Recover the source branch from the stash commit message. Git writes
/// stashes with one of two canonical headers:
///
///   - `WIP on <branch>: <sha> <subject>` (the default `git stash push`)
///   - `On <branch>: <subject>` (`git stash push -m <msg>`)
///
/// Returns `None` for non-canonical messages so the UI can fall back to
/// just the message text.
fn parse_branch_name(message: &str) -> Option<String> {
    let first_line = message.lines().next()?;
    let after_prefix = first_line
        .strip_prefix("WIP on ")
        .or_else(|| first_line.strip_prefix("On "))?;
    let colon = after_prefix.find(':')?;
    Some(after_prefix[..colon].to_string())
}
