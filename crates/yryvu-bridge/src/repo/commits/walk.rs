// SPDX-License-Identifier: AGPL-3.0-or-later

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::Path;

use anyhow::Context;
use graph_core::Commit;

use crate::backend::BackendError;

use super::super::common::{open_git2, open_repo};
use super::ref_scan::collect_ref_tips;

pub fn walk_commits(
    repo_path: &Path,
) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
    let repo = open_repo(repo_path)?;
    // git2 powers upstream resolution + ahead/behind counts for ref pills
    // (BACKEND: git2 — gix 0.68 lacks a stable `graph_ahead_behind` equivalent).
    let git2_repo = open_git2(repo_path).ok();

    let scan = collect_ref_tips(&repo, git2_repo.as_ref())?;
    if scan.tips.is_empty() {
        return Ok(Box::new(std::iter::empty()));
    }

    let walk = repo
        .rev_walk(scan.tips.clone())
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .context("start revwalk")
        .map_err(BackendError::Revwalk)?;

    let mut refs_by_oid = scan.refs_by_oid;
    let mut commits: HashMap<String, Commit> = HashMap::new();
    for info in walk {
        let info = info.map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        let gix_commit = repo
            .find_commit(info.id)
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;

        let author = gix_commit
            .author()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        // Committer is optional: malformed / ancient commits may lack it. The
        // frontend right-panel renders the committer block only when this is
        // `Some` AND differs from the author (bundle guard confirmed 2026-04-23).
        let committer = gix_commit.committer().ok();
        let message = gix_commit
            .message()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;

        let parents: Vec<String> = gix_commit.parent_ids().map(|id| id.to_string()).collect();

        let author_name = author.name.to_string();
        let author_email = author.email.to_string();
        // `gix_commit.time()` returns the *committer* time per gix docs — the
        // previous code aliased it as `author_date`, which silently worked for
        // author==committer commits but drifted on cherry-picks / rebases /
        // PR-merges. Split the two timestamps now that both flow to the right-panel.
        let author_date = author.time.seconds;
        let summary = message.summary().to_string();
        // Raw body, no trailer stripping — GitKraken renders the full body
        // including `Co-Authored-By:` lines (frontend parses trailers separately).
        let body = message.body.map(|b| b.to_string()).unwrap_or_default();
        let sha = info.id.to_string();

        let refs = refs_by_oid.remove(&info.id).unwrap_or_default();

        let (committer_name, committer_email, committer_date) = match committer {
            Some(c) => (
                Some(c.name.to_string()),
                Some(c.email.to_string()),
                Some(c.time.seconds),
            ),
            None => (None, None, None),
        };

        commits.insert(
            sha.clone(),
            Commit {
                sha,
                parents,
                summary,
                body,
                author_name,
                author_email,
                author_date,
                committer_name,
                committer_email,
                committer_date,
                refs,
            },
        );
    }

    // `seed_order`: the sequence of unique SHAs appearing in `scan.tips` in
    // the order `collect_ref_tips` added them (alphabetical by ref name per
    // `platform.local_branches()` / remote_branches / tags). This matches
    // `git log --date-order`'s insertion-order tie-break for commits sharing
    // the same committer-time — essential when testbeds / imported repos
    // have mass-identical timestamps.
    let mut seed_order: Vec<String> = Vec::with_capacity(scan.tips.len());
    let mut seen_seed: std::collections::HashSet<String> = std::collections::HashSet::new();
    for tip in &scan.tips {
        let sha = tip.to_string();
        if seen_seed.insert(sha.clone()) {
            seed_order.push(sha);
        }
    }

    let sorted = topo_sort_children_first(commits, &seed_order);
    Ok(Box::new(sorted.into_iter().map(Ok)))
}

/// Kahn topological sort that emits children before parents. Primary sort
/// key: committer-time descending. Tie-break: **insertion order** — seeds
/// get positions in the order `scan.tips` supplies them (alphabetical by
/// ref name), commits that become ready dynamically get the next
/// monotonically-increasing position. Matches `git log --date-order`'s
/// observed behaviour on repos with tied commit timestamps.
fn topo_sort_children_first(
    mut commits: HashMap<String, Commit>,
    seed_order: &[String],
) -> Vec<Commit> {
    // In-degree = number of loaded commits that reference this one as parent.
    let mut in_degree: HashMap<String, usize> = commits.keys().map(|k| (k.clone(), 0)).collect();
    for commit in commits.values() {
        for parent in &commit.parents {
            if let Some(entry) = in_degree.get_mut(parent) {
                *entry += 1;
            }
        }
    }

    // Position counter — advances every time a commit enters the heap so
    // earlier arrivals win the tie-break on equal committer-time.
    let mut position_counter: u64 = 0;
    let mut position: HashMap<String, u64> = HashMap::with_capacity(commits.len());

    let mut heap: BinaryHeap<TopoEntry> = BinaryHeap::new();
    // Seed the heap in `seed_order` so tied tips pop in ref-alphabetical
    // order (the order `collect_ref_tips` produced them).
    for sha in seed_order {
        if let Some(commit) = commits.get(sha) {
            if in_degree.get(sha).copied().unwrap_or(usize::MAX) == 0 {
                let pos = position_counter;
                position_counter += 1;
                position.insert(sha.clone(), pos);
                heap.push(TopoEntry {
                    time: commit.author_date,
                    position: pos,
                    sha: sha.clone(),
                });
            }
        }
    }

    let mut out = Vec::with_capacity(commits.len());
    while let Some(entry) = heap.pop() {
        let commit = match commits.remove(&entry.sha) {
            Some(c) => c,
            None => continue,
        };
        for parent in &commit.parents {
            if let Some(deg) = in_degree.get_mut(parent) {
                *deg -= 1;
                if *deg == 0 {
                    if let Some(parent_commit) = commits.get(parent) {
                        let pos = position_counter;
                        position_counter += 1;
                        position.insert(parent.clone(), pos);
                        heap.push(TopoEntry {
                            time: parent_commit.author_date,
                            position: pos,
                            sha: parent.clone(),
                        });
                    }
                }
            }
        }
        out.push(commit);
    }

    out
}

#[derive(PartialEq, Eq)]
struct TopoEntry {
    time: i64,
    position: u64,
    sha: String,
}

impl Ord for TopoEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        // Max-heap: primary committer-time desc (bigger time = pops first),
        // secondary position asc (lower position = pops first among ties).
        // Inverting position comparison to `other.position.cmp(&self.position)`
        // converts asc-priority to max-heap semantics.
        self.time
            .cmp(&other.time)
            .then_with(|| other.position.cmp(&self.position))
            .then_with(|| other.sha.cmp(&self.sha))
    }
}

impl PartialOrd for TopoEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
