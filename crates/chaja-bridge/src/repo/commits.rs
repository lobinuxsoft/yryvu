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
        let body = message
            .body
            .map(|b| b.to_string())
            .unwrap_or_default();
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
/// GitKraken pins the currently-checked-out branch as the trunk spine —
/// that's the commit line the user is actively working on, and the one
/// that stays column 0 across the whole graph. Fall through only when
/// the repo has no local HEAD attached (detached / fresh clone).
///
/// Resolution order:
///
/// 1. **Local `HEAD` if attached** to a named branch — mirrors GK's
///    behaviour of pinning the current branch.
/// 2. `refs/remotes/origin/HEAD` peeled — fallback for detached HEAD,
///    uses the remote's declared default branch.
/// 3. First local branch matching `main`, `master`, `development`, or
///    `trunk` — last-ditch fallback when neither HEAD source is usable.
///
/// Previously step 1 was the remote HEAD, which broke for repos where
/// `origin/HEAD` points to a stale or empty branch (e.g. `main` that
/// still holds only the initial commit while all work landed on
/// `development`). The pinned set would end up as a single-commit chain
/// and the actual development spine would render on lane 1+ instead of
/// lane 0.
///
/// Returns `None` when none of the candidates resolve — in that case
/// the caller should feed an empty `HashSet` into the lane allocator,
/// which collapses to pure leftmost-free.
pub fn pick_pinned_head_for_path(repo_path: &Path) -> Option<String> {
    let repo = super::common::open_repo(repo_path).ok()?;
    pick_pinned_head(&repo)
}

pub fn pick_pinned_head(repo: &gix::Repository) -> Option<String> {
    if let Ok(Some(head_name)) = repo.head_name() {
        let name = head_name.as_bstr().to_string();
        if let Some(id) = peel_ref(repo, &name) {
            return Some(id);
        }
    }

    if let Some(id) = peel_ref(repo, "refs/remotes/origin/HEAD") {
        return Some(id);
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
        let mut reference =
            reference.map_err(|e| BackendError::Revwalk(anyhow!("resolve local branch: {e}")))?;
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
        let mut reference =
            reference.map_err(|e| BackendError::Revwalk(anyhow!("resolve remote branch: {e}")))?;
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
