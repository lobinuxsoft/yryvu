// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-mode SoA indexes + builders. Each mode keeps its own parallel
//! arrays so the matcher hot loop iterates contiguous memory and ties
//! break by recency without extra fetches.

use std::path::Path;

use anyhow::anyhow;
use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::common::{git2_err, open_git2};

/// Hard cap on the per-mode corpus. Acceptance is "search 100k commits
/// under 30ms typing latency" — beyond that we'd want batching or a
/// streaming matcher. Cap is the safety net; real-world repos rarely
/// reach it.
const MAX_ENTRIES_PER_MODE: usize = 100_000;

/// Counts returned to the UI so the tabs can show "(N)" badges.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
pub struct IndexCounts {
    pub commits: u32,
    pub files: u32,
    pub branches: u32,
    pub tags: u32,
    pub stashes: u32,
}

#[derive(Clone, Debug, Default)]
pub struct SearchIndex {
    pub commits: CommitSoA,
    pub branches: BranchSoA,
    pub tags: TagSoA,
    pub stashes: StashSoA,
    pub files: FileSoA,
}

impl SearchIndex {
    pub fn counts(&self) -> IndexCounts {
        IndexCounts {
            commits: self.commits.oids.len() as u32,
            files: self.files.paths.len() as u32,
            branches: self.branches.names.len() as u32,
            tags: self.tags.names.len() as u32,
            stashes: self.stashes.messages.len() as u32,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct CommitSoA {
    pub oids: Vec<String>,
    pub short_oids: Vec<String>,
    pub summaries: Vec<String>,
    pub authors: Vec<String>,
    pub timestamps: Vec<i64>,
}

#[derive(Clone, Debug, Default)]
pub struct BranchSoA {
    pub names: Vec<String>,
    pub tips: Vec<String>,
    pub is_remote: Vec<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct TagSoA {
    pub names: Vec<String>,
    pub targets: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct StashSoA {
    pub messages: Vec<String>,
    pub oids: Vec<String>,
    pub stack_idx: Vec<u32>,
}

#[derive(Clone, Debug, Default)]
pub struct FileSoA {
    pub paths: Vec<String>,
}

/// Build (or rebuild) the index for a repo and store it in the cache.
/// Returns the counts so the UI can light up the mode tabs immediately.
pub fn build_index(repo_path: &Path) -> Result<IndexCounts, BackendError> {
    let idx = build_index_inner(repo_path)?;
    let counts = idx.counts();
    super::cache_insert(repo_path, idx);
    Ok(counts)
}

/// Drop the cached index. Called from the IPC layer on `refresh` hooks
/// when refs / worktree / stash list changes.
pub fn invalidate_index(repo_path: &Path) {
    super::cache_clear(repo_path);
}

pub(crate) fn build_index_inner(repo_path: &Path) -> Result<SearchIndex, BackendError> {
    let repo = open_git2(repo_path)?;
    let commits = build_commits(&repo)?;
    let branches = build_branches(&repo)?;
    let tags = build_tags(&repo)?;
    let stashes = build_stashes(repo_path)?;
    let files = build_files(&repo)?;
    Ok(SearchIndex {
        commits,
        branches,
        tags,
        stashes,
        files,
    })
}

fn build_commits(repo: &git2::Repository) -> Result<CommitSoA, BackendError> {
    let mut soa = CommitSoA::default();
    let head = match repo.head().and_then(|h| h.peel_to_commit()) {
        Ok(c) => c,
        Err(_) => return Ok(soa),
    };
    let mut revwalk = repo.revwalk().map_err(git2_err)?;
    revwalk.push(head.id()).map_err(git2_err)?;
    for oid in revwalk.take(MAX_ENTRIES_PER_MODE) {
        let oid = oid.map_err(git2_err)?;
        let commit = repo.find_commit(oid).map_err(git2_err)?;
        let oid_str = oid.to_string();
        soa.short_oids.push(oid_str.chars().take(7).collect());
        soa.oids.push(oid_str);
        soa.summaries
            .push(commit.summary().unwrap_or("").to_string());
        soa.authors
            .push(commit.author().name().unwrap_or("").to_string());
        soa.timestamps.push(commit.time().seconds());
    }
    Ok(soa)
}

fn build_branches(repo: &git2::Repository) -> Result<BranchSoA, BackendError> {
    let mut soa = BranchSoA::default();
    let branches = repo.branches(None).map_err(git2_err)?;
    for entry in branches {
        let (branch, kind) = entry.map_err(git2_err)?;
        let name = match branch.name().map_err(git2_err)? {
            Some(n) => n.to_string(),
            None => continue,
        };
        let tip = branch
            .get()
            .peel_to_commit()
            .map(|c| c.id().to_string())
            .unwrap_or_default();
        soa.names.push(name);
        soa.tips.push(tip);
        soa.is_remote.push(kind == git2::BranchType::Remote);
    }
    Ok(soa)
}

fn build_tags(repo: &git2::Repository) -> Result<TagSoA, BackendError> {
    let mut soa = TagSoA::default();
    let tag_names = repo.tag_names(None).map_err(git2_err)?;
    for name in tag_names.iter().flatten() {
        let full_ref = format!("refs/tags/{name}");
        let target = repo
            .find_reference(&full_ref)
            .ok()
            .and_then(|r| r.peel_to_commit().ok())
            .map(|c| c.id().to_string())
            .unwrap_or_default();
        soa.names.push(name.to_string());
        soa.targets.push(target);
    }
    Ok(soa)
}

fn build_stashes(repo_path: &Path) -> Result<StashSoA, BackendError> {
    let mut soa = StashSoA::default();
    // stash_foreach takes &mut Repository, so re-open instead of
    // borrowing the immutable handle from build_index_inner.
    let mut repo = git2::Repository::open(repo_path).map_err(git2_err)?;
    let mut entries: Vec<(usize, git2::Oid, String)> = Vec::new();
    let _ = repo.stash_foreach(|idx, msg, oid| {
        entries.push((idx, *oid, msg.to_string()));
        true
    });
    for (idx, oid, msg) in entries {
        soa.stack_idx.push(idx as u32);
        soa.oids.push(oid.to_string());
        soa.messages.push(msg);
    }
    Ok(soa)
}

fn build_files(repo: &git2::Repository) -> Result<FileSoA, BackendError> {
    let mut soa = FileSoA::default();
    let head = match repo.head().and_then(|h| h.peel_to_tree()) {
        Ok(t) => t,
        Err(_) => return Ok(soa),
    };
    head.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if soa.paths.len() >= MAX_ENTRIES_PER_MODE {
            return git2::TreeWalkResult::Abort;
        }
        if entry.kind() == Some(git2::ObjectType::Blob) {
            if let Some(name) = entry.name() {
                soa.paths.push(format!("{dir}{name}"));
            }
        }
        git2::TreeWalkResult::Ok
    })
    .map_err(|e| BackendError::Git(anyhow!(e)))?;
    Ok(soa)
}
