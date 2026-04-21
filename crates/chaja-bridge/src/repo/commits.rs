// SPDX-License-Identifier: AGPL-3.0-or-later

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::Path;

use anyhow::{anyhow, Context};
use graph_core::{Commit, RefKind, RefTag};

use crate::backend::{BackendError, CommitDiff};

use super::common::{diff_to_file_diffs, git2_err, open_git2, open_repo};

pub fn walk_commits(
    repo_path: &Path,
) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
    let repo = open_repo(repo_path)?;

    let scan = collect_ref_tips(&repo)?;
    if scan.tips.is_empty() {
        return Ok(Box::new(std::iter::empty()));
    }

    // gix's ByCommitTime sort is not strictly topological — with tied timestamps
    // across multiple seeded tips the root can land anywhere in the output.
    // Collect eagerly, then re-sort via Kahn's algorithm with committer_time as
    // tiebreaker. This guarantees children appear before their parents (invariant
    // required by the lane assigner).
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
        let time = gix_commit
            .time()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        let message = gix_commit
            .message()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;

        let parents: Vec<String> = gix_commit.parent_ids().map(|id| id.to_string()).collect();

        let author_line = format!("{} <{}>", author.name, author.email);
        let summary = message.summary().to_string();
        let sha = info.id.to_string();

        let refs = refs_by_oid.remove(&info.id).unwrap_or_default();

        commits.insert(
            sha.clone(),
            Commit {
                sha,
                parents,
                summary,
                author: author_line,
                author_date: time.seconds,
                refs,
            },
        );
    }

    let sorted = topo_sort_children_first(commits);
    Ok(Box::new(sorted.into_iter().map(Ok)))
}

/// Kahn topological sort that emits children before parents. Ties (commits
/// whose in-degree reaches zero simultaneously) are broken by committer_time
/// descending, matching the visual order of `git log --topo-order --date-order`.
fn topo_sort_children_first(mut commits: HashMap<String, Commit>) -> Vec<Commit> {
    // In-degree = number of commits in our set that reference this commit as parent.
    // Leaves (ref tips reachable only from above) start at 0.
    let mut in_degree: HashMap<String, usize> = commits.keys().map(|k| (k.clone(), 0)).collect();
    for commit in commits.values() {
        for parent in &commit.parents {
            if let Some(entry) = in_degree.get_mut(parent) {
                *entry += 1;
            }
        }
    }

    let mut heap: BinaryHeap<TopoEntry> = BinaryHeap::new();
    for (sha, deg) in &in_degree {
        if *deg == 0 {
            if let Some(commit) = commits.get(sha) {
                heap.push(TopoEntry {
                    time: commit.author_date,
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
                        heap.push(TopoEntry {
                            time: parent_commit.author_date,
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
    sha: String,
}

impl Ord for TopoEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        // Max-heap on time so newer commits are emitted first among tied-ready
        // leaves. SHA breaks perfect ties deterministically.
        self.time
            .cmp(&other.time)
            .then_with(|| other.sha.cmp(&self.sha))
    }
}

impl PartialOrd for TopoEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
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

/// Pick an automatic pin target for the graph trunk.
///
/// Mirrors Chajá's proposed auto-pin fallback from
/// `docs/research/gitkraken-graph/05-trunk-pinning.md`:
///
/// 1. `refs/remotes/origin/HEAD` peeled — the remote's default branch.
/// 2. Local `HEAD` if attached to a named branch.
/// 3. First local branch matching `main`, `master`, `development`, `trunk`.
///
/// Returns `None` when the repo has no candidate (empty repo, detached HEAD
/// with no obvious default). In that case the caller should feed an empty
/// `HashSet` into the lane allocator, which collapses to pure leftmost-free.
pub fn pick_pinned_head_for_path(repo_path: &Path) -> Option<String> {
    let repo = super::common::open_repo(repo_path).ok()?;
    pick_pinned_head(&repo)
}

pub fn pick_pinned_head(repo: &gix::Repository) -> Option<String> {
    if let Some(id) = peel_ref(repo, "refs/remotes/origin/HEAD") {
        return Some(id);
    }

    if let Ok(Some(head_name)) = repo.head_name() {
        let name = head_name.as_bstr().to_string();
        if let Some(id) = peel_ref(repo, &name) {
            return Some(id);
        }
    }

    const TRUNK_CANDIDATES: &[&str] = &[
        "refs/heads/main",
        "refs/heads/master",
        "refs/heads/development",
        "refs/heads/trunk",
    ];
    for candidate in TRUNK_CANDIDATES {
        if let Some(id) = peel_ref(repo, candidate) {
            return Some(id);
        }
    }

    None
}

fn peel_ref(repo: &gix::Repository, full_name: &str) -> Option<String> {
    let mut reference = repo.find_reference(full_name).ok()?;
    let id = reference.peel_to_id_in_place().ok()?.detach();
    Some(id.to_string())
}

/// Output of [`collect_ref_tips`]: the set of starting commits to seed the
/// revwalk with, plus a map from each tip's object id to the [`RefTag`] list
/// describing the refs that resolve to it.
///
/// The `refs_by_oid` map is drained as commits are emitted during the walk —
/// each emitted `Commit` takes its share of refs from here.
struct RefScan {
    tips: Vec<gix::ObjectId>,
    refs_by_oid: HashMap<gix::ObjectId, Vec<RefTag>>,
}

fn collect_ref_tips(repo: &gix::Repository) -> Result<RefScan, BackendError> {
    let platform = repo
        .references()
        .context("open references platform")
        .map_err(BackendError::Revwalk)?;

    let mut tips: Vec<gix::ObjectId> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut refs_by_oid: HashMap<gix::ObjectId, Vec<RefTag>> = HashMap::new();

    for reference in platform
        .local_branches()
        .context("iterate local branches")
        .map_err(BackendError::Revwalk)?
    {
        let mut reference = reference
            .map_err(|e| BackendError::Revwalk(anyhow!("resolve local branch: {e}")))?;
        let short = reference.name().shorten().to_string();
        let id = reference
            .peel_to_id_in_place()
            .context("peel local branch tip")
            .map_err(BackendError::Revwalk)?
            .detach();
        if seen.insert(id) {
            tips.push(id);
        }
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: short,
            kind: RefKind::Branch,
        });
    }

    for reference in platform
        .remote_branches()
        .context("iterate remote branches")
        .map_err(BackendError::Revwalk)?
    {
        let mut reference = reference
            .map_err(|e| BackendError::Revwalk(anyhow!("resolve remote branch: {e}")))?;
        let short = reference.name().shorten().to_string();
        // Skip symbolic HEAD pointers like refs/remotes/origin/HEAD — they
        // duplicate the branch they alias.
        if short.ends_with("/HEAD") {
            continue;
        }
        let id = reference
            .peel_to_id_in_place()
            .context("peel remote branch tip")
            .map_err(BackendError::Revwalk)?
            .detach();
        if seen.insert(id) {
            tips.push(id);
        }
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: short,
            kind: RefKind::RemoteBranch,
        });
    }

    for reference in platform
        .tags()
        .context("iterate tags")
        .map_err(BackendError::Revwalk)?
    {
        let mut reference =
            reference.map_err(|e| BackendError::Revwalk(anyhow!("resolve tag: {e}")))?;
        let short = reference.name().shorten().to_string();
        let id = reference
            .peel_to_id_in_place()
            .context("peel tag tip")
            .map_err(BackendError::Revwalk)?
            .detach();
        if seen.insert(id) {
            tips.push(id);
        }
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: short,
            kind: RefKind::Tag,
        });
    }

    // HEAD as a distinct ref entry. When attached to a branch, emit HEAD at
    // the same tip so the frontend can render the checkmark / pin annotation
    // without having to cross-reference head_name separately. When detached,
    // HEAD is the only ref and becomes the sole seed.
    if let Ok(head_id) = repo.head_id() {
        let id = head_id.detach();
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: "HEAD".to_string(),
            kind: RefKind::Head,
        });
        if seen.insert(id) {
            tips.push(id);
        }
    }

    Ok(RefScan { tips, refs_by_oid })
}
