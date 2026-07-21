// SPDX-License-Identifier: AGPL-3.0-or-later

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::Path;

use anyhow::Context;
use graph_core::{Commit, NodeType};
use rayon::prelude::*;

use crate::backend::BackendError;

use super::super::common::{open_git2, open_repo};
use super::super::stashes::list_stashes;
use super::ref_scan::collect_ref_tips;

/// Walk reachable commits newest-first and return them children-first
/// (topo-sorted). `limit` caps how many of the newest commits are loaded:
/// the revwalk is lazy, so `Some(n)` stops after `n` commits and never pays
/// for the tail of a large history. Commits at the boundary keep parent SHAs
/// that fall outside the window; the topo sort and `layout_commits` tolerate
/// missing parents (edges terminate at the boundary). `None` walks everything.
pub fn walk_commits(
    repo_path: &Path,
    limit: Option<usize>,
) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
    let repo = open_repo(repo_path)?;
    // git2 powers upstream resolution + ahead/behind counts for ref pills
    // (BACKEND: git2 — gix 0.68 lacks a stable `graph_ahead_behind` equivalent).
    let git2_repo = open_git2(repo_path).ok();

    let scan = collect_ref_tips(&repo, git2_repo.as_ref())?;

    // Stash shas seed the walk alongside ref tips so each `refs/stash@{N}`
    // shows up as its own node in the graph (GK rev-walk loop tagging,
    // bundle `:189083`). `list_stashes` returns entries newest-first; we
    // build a sha → subject map keyed by the stash commit so the emit
    // loop can flip `node_type = Stash` and override the message.
    let stashes = list_stashes(repo_path).unwrap_or_default();
    let stash_subject_by_sha: HashMap<String, String> = stashes
        .iter()
        .map(|s| {
            let subject = s.message.lines().next().unwrap_or("").to_string();
            (s.sha.clone(), subject)
        })
        .collect();

    let mut all_tips = scan.tips.clone();
    let mut seen_tips: std::collections::HashSet<gix::ObjectId> =
        scan.tips.iter().copied().collect();
    for entry in &stashes {
        if let Ok(oid) = gix::ObjectId::from_hex(entry.sha.as_bytes()) {
            if seen_tips.insert(oid) {
                all_tips.push(oid);
            }
        }
    }

    if all_tips.is_empty() {
        return Ok(Box::new(std::iter::empty()));
    }

    // gix's `ByCommitTime` sort decodes every commit's committer-time to
    // order the priority queue — but that order is thrown away: the emit
    // loop drops commits into an unordered `HashMap` and the downstream
    // `topo_sort_children_first` re-derives the order from `author_date` +
    // `seed_order`. So when we load the *whole* history (`limit == None`)
    // the sort is pure waste; `BreadthFirst` merely enumerates the
    // reachable set, which is all the topo sort needs, and skips the
    // time-decode pass (~2× faster traversal on large repos, #181).
    //
    // A bounded walk (`limit == Some`) is different: it pages in the
    // *newest N* commits, which only `ByCommitTime` guarantees — breadth
    // order would load an arbitrary N. Keep the time sort there.
    let sorting = match limit {
        None => gix::revision::walk::Sorting::BreadthFirst,
        Some(_) => gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ),
    };
    let walk = repo
        .rev_walk(all_tips.clone())
        .sorting(sorting)
        .all()
        .context("start revwalk")
        .map_err(BackendError::Revwalk)?;

    let ids: Vec<gix::ObjectId> = walk
        .take(limit.unwrap_or(usize::MAX))
        .map(|info| {
            info.map(|i| i.id)
                .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))
        })
        .collect::<Result<Vec<_>, _>>()?;

    // Decode each commit object in parallel. The per-commit work (find +
    // author / committer / message / parents) is independent and is the
    // dominant cost of the walk on large repos; the serial loop left 7 of
    // 8 cores idle. gix's object cache isn't `Sync`, so each rayon worker
    // gets its own thread-local handle off the shared `ThreadSafeRepository`
    // (the object store itself is shared, only the caches are per-handle).
    // `refs_by_oid` / `stash_subject_by_sha` are read-only here, so a plain
    // `&` shared across workers is sound.
    let sync_repo = repo.clone().into_sync();
    let decoded: Vec<(String, Commit)> = ids
        .into_par_iter()
        .map_init(
            || sync_repo.to_thread_local(),
            |tl_repo, id| decode_commit(tl_repo, id, &scan.refs_by_oid, &stash_subject_by_sha),
        )
        .collect::<Result<Vec<_>, _>>()?;

    let mut commits: HashMap<String, Commit> = HashMap::with_capacity(decoded.len());
    for (sha, commit) in decoded {
        commits.insert(sha, commit);
    }

    // `seed_order`: the sequence of unique SHAs appearing in the full tip
    // set (ref tips first in `collect_ref_tips` order, then stash tips in
    // reflog order — newest-first per `list_stashes`). This matches
    // `git log --date-order`'s insertion-order tie-break for commits sharing
    // the same committer-time — essential when testbeds / imported repos
    // have mass-identical timestamps.
    let mut seed_order: Vec<String> = Vec::with_capacity(all_tips.len());
    let mut seen_seed: std::collections::HashSet<String> = std::collections::HashSet::new();
    for tip in &all_tips {
        let sha = tip.to_string();
        if seen_seed.insert(sha.clone()) {
            seed_order.push(sha);
        }
    }

    let sorted = topo_sort_children_first(commits, &seed_order);
    Ok(Box::new(sorted.into_iter().map(Ok)))
}

/// Decode one commit object into the graph-core [`Commit`] shape. Pulled
/// out of the walk loop so it can run on a rayon worker; takes read-only
/// borrows of the ref + stash lookups so many workers share them.
fn decode_commit(
    repo: &gix::Repository,
    id: gix::ObjectId,
    refs_by_oid: &HashMap<gix::ObjectId, Vec<graph_core::RefTag>>,
    stash_subject_by_sha: &HashMap<String, String>,
) -> Result<(String, Commit), BackendError> {
    let gix_commit = repo
        .find_commit(id)
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
    // Stash entries override the subject with the stash message so the
    // graph row shows "WIP on main: …" instead of the underlying commit's
    // summary (which is just the index parent's subject in git's stash
    // commit format).
    let sha = id.to_string();
    let stash_subject = stash_subject_by_sha.get(&sha).cloned();
    let summary = stash_subject
        .clone()
        .unwrap_or_else(|| message.summary().to_string());
    // Raw body, no trailer stripping — GitKraken renders the full body
    // including `Co-Authored-By:` lines (frontend parses trailers separately).
    // For stash entries the body is empty since the subject already carries
    // the whole identifier.
    let body = if stash_subject.is_some() {
        String::new()
    } else {
        message.body.map(|b| b.to_string()).unwrap_or_default()
    };
    let node_type = if stash_subject.is_some() {
        NodeType::Stash
    } else {
        NodeType::Commit
    };

    let refs = refs_by_oid.get(&id).cloned().unwrap_or_default();

    let (committer_name, committer_email, committer_date) = match committer {
        Some(c) => (
            Some(c.name.to_string()),
            Some(c.email.to_string()),
            Some(c.time.seconds),
        ),
        None => (None, None, None),
    };

    Ok((
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
            node_type,
        },
    ))
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

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;
    use tempfile::TempDir;

    /// Build a linear chain of `n` commits (`c0` .. `c{n-1}`), returning the
    /// temp dir so it lives for the duration of the test.
    fn linear_repo(n: usize) -> TempDir {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let sig = Signature::now("t", "t@e").unwrap();
        let mut parent: Option<git2::Oid> = None;
        for i in 0..n {
            fs::write(dir.path().join("f.txt"), format!("v{i}")).unwrap();
            let mut index = repo.index().unwrap();
            index
                .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
                .unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let parents: Vec<git2::Commit> = parent
                .into_iter()
                .map(|o| repo.find_commit(o).unwrap())
                .collect();
            let refs: Vec<&git2::Commit> = parents.iter().collect();
            parent = Some(
                repo.commit(Some("HEAD"), &sig, &sig, &format!("c{i}"), &tree, &refs)
                    .unwrap(),
            );
        }
        dir
    }

    fn walked(dir: &Path, limit: Option<usize>) -> Vec<Commit> {
        walk_commits(dir, limit)
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    #[test]
    fn limit_caps_to_the_newest_commits() {
        let dir = linear_repo(10);
        assert_eq!(walked(dir.path(), Some(3)).len(), 3);
        assert_eq!(walked(dir.path(), Some(10)).len(), 10);
    }

    #[test]
    fn none_or_oversized_limit_returns_all() {
        let dir = linear_repo(5);
        assert_eq!(walked(dir.path(), None).len(), 5);
        assert_eq!(walked(dir.path(), Some(100)).len(), 5);
    }

    /// A diamond merge built in one burst — the commits share a
    /// second-resolution timestamp, the exact tie case where gix's
    /// committer-time order isn't topological. `limit: None` now walks
    /// `BreadthFirst` (the time sort is discarded downstream), so this
    /// pins that the children-first invariant still holds: every commit
    /// appears before each of its in-window parents.
    #[test]
    fn full_walk_is_children_first_across_a_merge() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let sig = Signature::now("t", "t@e").unwrap();

        let commit = |repo: &Repository, msg: &str, parents: &[git2::Oid]| -> git2::Oid {
            let mut index = repo.index().unwrap();
            std::fs::write(dir.path().join(format!("{msg}.txt")), msg).unwrap();
            index
                .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
                .unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let ps: Vec<git2::Commit> = parents
                .iter()
                .map(|o| repo.find_commit(*o).unwrap())
                .collect();
            let refs: Vec<&git2::Commit> = ps.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs)
                .unwrap()
        };

        // base → (a, b) → merge
        let base = commit(&repo, "base", &[]);
        let a = commit(&repo, "a", &[base]);
        repo.set_head_detached(base).unwrap();
        let b = commit(&repo, "b", &[base]);
        // git2 requires HEAD == first parent of a new commit.
        repo.set_head_detached(a).unwrap();
        let merge = commit(&repo, "merge", &[a, b]);
        repo.set_head_detached(merge).unwrap();

        let rows = walked(dir.path(), None);
        assert_eq!(rows.len(), 4, "base + a + b + merge");

        // Index of each sha in the emitted order; a child must precede
        // every parent that's also in the window.
        let pos: HashMap<&str, usize> = rows
            .iter()
            .enumerate()
            .map(|(i, c)| (c.sha.as_str(), i))
            .collect();
        for row in &rows {
            for parent in &row.parents {
                if let Some(&pp) = pos.get(parent.as_str()) {
                    assert!(
                        pos[row.sha.as_str()] < pp,
                        "child {} must precede parent {}",
                        row.summary,
                        parent
                    );
                }
            }
        }
        // The merge (only childless node) is newest, so it leads.
        assert_eq!(rows[0].sha, merge.to_string(), "merge leads children-first");
    }

    #[test]
    fn boundary_commit_keeps_its_out_of_window_parent() {
        // Rows come children-first (newest first); the last one is the oldest
        // in the window. Its parent is excluded by the cap but the sha must
        // survive so `layout_commits` can terminate the edge at the boundary.
        let dir = linear_repo(6);
        let rows = walked(dir.path(), Some(2));
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows.last().unwrap().parents.len(),
            1,
            "boundary commit retains its parent sha"
        );
    }
}
