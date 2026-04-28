// SPDX-License-Identifier: AGPL-3.0-or-later

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::Path;

use anyhow::{anyhow, Context};
use graph_core::{Commit, RefKind, RefTag};

use crate::backend::{BackendError, CombinedDiff, CombinedDiffKind, CommitDetail, CommitDiff};

use super::common::{diff_to_file_diffs, git2_err, open_git2, open_repo};

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

/// Multi-revision / WIP-aware diff for the inspector. `shas` is youngest-first
/// (graph-row order, matching the frontend's selection order). The kind tag in
/// the result lets the right panel pick its header copy without re-deriving the
/// state.
///
/// Tree pairing follows GitKraken's `getCommitDiffSelectionTrees` convention:
///
/// | Selection                        | Old tree                 | New tree                  |
/// |----------------------------------|--------------------------|---------------------------|
/// | 1 commit                         | first parent of commit   | commit                    |
/// | N commits (N ≥ 2)                | first parent of oldest   | youngest                  |
/// | WIP only                         | HEAD                     | working tree (idx + wt)   |
/// | 1 commit + WIP                   | commit                   | working tree (idx + wt)   |
/// | N commits + WIP (N ≥ 2)          | first parent of oldest   | working tree (idx + wt)   |
///
/// "Working tree" means **index merged with worktree** — anything the user
/// would commit if they staged everything. Matches GK's `WIP` semantics.
///
/// Empty `shas` + `!include_workdir` is a programming error and returns an
/// `InvalidArgument`-flavoured `Revwalk` error rather than panicking — the
/// frontend should never construct that combination, but a safe rejection is
/// cheaper to debug than a backend crash.
pub fn combined_commit_diff(
    repo_path: &Path,
    shas: &[String],
    include_workdir: bool,
) -> Result<CombinedDiff, BackendError> {
    if shas.is_empty() && !include_workdir {
        return Err(BackendError::Revwalk(anyhow!(
            "combined_commit_diff requires at least one sha or include_workdir=true",
        )));
    }

    let repo = open_git2(repo_path)?;
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.include_typechange(true).context_lines(3);

    // shas come in youngest-first order; oldest sits at the back of the slice.
    let youngest_sha = shas.first();
    let oldest_sha = shas.last();

    let oldest_commit = match oldest_sha {
        Some(sha) => Some(
            repo.find_commit(git2::Oid::from_str(sha).map_err(git2_err)?)
                .map_err(git2_err)?,
        ),
        None => None,
    };
    let youngest_commit = match youngest_sha {
        Some(sha) => Some(
            repo.find_commit(git2::Oid::from_str(sha).map_err(git2_err)?)
                .map_err(git2_err)?,
        ),
        None => None,
    };

    // `old_tree` is the comparison's "before" side. `None` means no parent
    // (root commit) — `diff_tree_to_*` accepts `None` as "empty tree" so the
    // diff lights up every file as added, which matches what users expect for
    // a root commit's inspector view.
    let old_tree = match oldest_commit.as_ref() {
        Some(c) if c.parent_count() > 0 => {
            Some(c.parent(0).map_err(git2_err)?.tree().map_err(git2_err)?)
        }
        Some(_) => None, // root commit
        None => {
            // WIP-only path: compare against HEAD.
            match repo.head() {
                Ok(head) => match head.peel_to_commit() {
                    Ok(head_commit) => Some(head_commit.tree().map_err(git2_err)?),
                    Err(_) => None,
                },
                Err(_) => None, // unborn HEAD — empty tree as old side
            }
        }
    };

    let mut diff = if include_workdir {
        repo.diff_tree_to_workdir_with_index(old_tree.as_ref(), Some(&mut diff_opts))
            .map_err(git2_err)?
    } else {
        let new_tree = youngest_commit
            .as_ref()
            .ok_or_else(|| BackendError::Revwalk(anyhow!("youngest commit missing")))?
            .tree()
            .map_err(git2_err)?;
        repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut diff_opts))
            .map_err(git2_err)?
    };

    // Renames are only meaningful for tree-to-tree comparisons; running
    // `find_similar` on a workdir diff is also valid (libgit2 supports it) and
    // matches the Single-commit branch's behaviour.
    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true).copies(true);
    diff.find_similar(Some(&mut find_opts)).map_err(git2_err)?;

    let files = diff_to_file_diffs(&diff)?;

    let n_commits = u32::try_from(shas.len()).unwrap_or(u32::MAX);
    let kind = match (n_commits, include_workdir) {
        (0, true) => CombinedDiffKind::WipOnly,
        (0, false) => unreachable!("guarded above"),
        (1, false) => CombinedDiffKind::Single,
        (1, true) => CombinedDiffKind::CommitVsWip,
        (_, false) => CombinedDiffKind::Multi,
        (_, true) => CombinedDiffKind::MultiVsWip,
    };

    Ok(CombinedDiff {
        kind,
        n_commits,
        include_workdir,
        shas: shas.to_vec(),
        files,
    })
}

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

/// Resolved tracking info for a single local branch. All-zero default means
/// "no upstream configured or resolution failed" — the branch renders without
/// the upstream indicator.
#[derive(Debug, Default)]
struct UpstreamInfo {
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
}

/// Resolve the upstream tracking branch + ahead/behind counts for a local
/// branch using git2. Returns `None` only on errors that prevent classifying
/// the branch (no upstream configured returns `Some(default)` with empty data).
///
/// Driven by `branch.<name>.remote` + `branch.<name>.merge` in the repo
/// config — git2's `Branch::upstream()` reads those internally. We use
/// `graph_ahead_behind` which is libgit2's optimized two-pointer walk
/// (`git_graph_ahead_behind`) to avoid loading every commit on either side.
fn resolve_upstream_tracking(
    repo: &git2::Repository,
    local_short_name: &str,
) -> Option<UpstreamInfo> {
    let local = repo
        .find_branch(local_short_name, git2::BranchType::Local)
        .ok()?;
    let upstream = local.upstream().ok()?;
    let upstream_name = upstream.name().ok().flatten()?.to_string();
    let local_oid = local.get().target()?;
    let upstream_oid = upstream.get().target()?;
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid).ok()?;
    Some(UpstreamInfo {
        upstream: Some(upstream_name),
        ahead: ahead as u32,
        behind: behind as u32,
    })
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

fn collect_ref_tips(
    repo: &gix::Repository,
    git2_repo: Option<&git2::Repository>,
) -> Result<RefScan, BackendError> {
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
        let upstream = git2_repo
            .and_then(|r| resolve_upstream_tracking(r, &short))
            .unwrap_or_default();
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: short,
            kind: RefKind::Branch,
            upstream: upstream.upstream,
            ahead: upstream.ahead,
            behind: upstream.behind,
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
            ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
        });
        if seen.insert(id) {
            tips.push(id);
        }
    }

    Ok(RefScan { tips, refs_by_oid })
}
