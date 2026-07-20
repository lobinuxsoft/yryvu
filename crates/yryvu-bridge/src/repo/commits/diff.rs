// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::anyhow;

use crate::backend::{
    BackendError, CombinedDiff, CombinedDiffKind, CombinedDiffSummary, CommitDiff,
};

use super::super::common::{diff_to_file_diffs, diff_to_file_metas, git2_err, open_git2};

/// Skip `find_similar` rename/copy detection on diffs exceeding this many
/// deltas. libgit2's similarity scan is O(N²) on file pairs, so on repos like
/// `eggscape` (~15K dirty files) a WIP diff stalls for several seconds.
/// GitKraken's saga (`getDiffForOneCommit`) differentiates by mode (EXACT_MATCH
/// for committed, ALL for WIP); we don't have that luxury on planet-scale
/// working trees, so we gate by raw delta count instead. 5000 is a starting
/// heuristic — see issue #177.
const RENAME_DETECTION_DELTA_LIMIT: usize = 5000;

/// Pure threshold check, factored out so the gate can be exercised without
/// fabricating a 5000-delta libgit2 fixture.
fn should_skip_rename_detection(delta_count: usize) -> bool {
    delta_count > RENAME_DETECTION_DELTA_LIMIT
}

/// Apply rename/copy similarity detection unless the diff is too large.
/// Returns `true` when detection was skipped so callers can surface it.
fn apply_rename_detection(diff: &mut git2::Diff<'_>) -> Result<bool, BackendError> {
    if should_skip_rename_detection(diff.deltas().len()) {
        return Ok(true);
    }
    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true).copies(true);
    diff.find_similar(Some(&mut find_opts)).map_err(git2_err)?;
    Ok(false)
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

    apply_rename_detection(&mut diff)?;

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
/// The built `git2::Diff` plus the derived kind / counts, shared by the
/// full [`combined_commit_diff`] and the metadata-only
/// [`combined_commit_diff_summary`]. The diff borrows `repo`, so the
/// caller owns the `Repository` and this stays a borrow.
struct CombinedDiffPlan<'r> {
    diff: git2::Diff<'r>,
    kind: CombinedDiffKind,
    n_commits: u32,
    rename_detection_skipped: bool,
}

/// Resolve the tree pairing, build the diff, and run rename detection —
/// everything up to (but not including) turning deltas into UI rows. The
/// two public entry points differ only in whether they materialise hunks.
fn build_combined_diff<'r>(
    repo: &'r git2::Repository,
    shas: &[String],
    include_workdir: bool,
) -> Result<CombinedDiffPlan<'r>, BackendError> {
    if shas.is_empty() && !include_workdir {
        return Err(BackendError::Revwalk(anyhow!(
            "combined diff requires at least one sha or include_workdir=true",
        )));
    }

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
    let rename_detection_skipped = apply_rename_detection(&mut diff)?;

    let n_commits = u32::try_from(shas.len()).unwrap_or(u32::MAX);
    let kind = match (n_commits, include_workdir) {
        (0, true) => CombinedDiffKind::WipOnly,
        (0, false) => unreachable!("guarded above"),
        (1, false) => CombinedDiffKind::Single,
        (1, true) => CombinedDiffKind::CommitVsWip,
        (_, false) => CombinedDiffKind::Multi,
        (_, true) => CombinedDiffKind::MultiVsWip,
    };

    Ok(CombinedDiffPlan {
        diff,
        kind,
        n_commits,
        rename_detection_skipped,
    })
}

pub fn combined_commit_diff(
    repo_path: &Path,
    shas: &[String],
    include_workdir: bool,
) -> Result<CombinedDiff, BackendError> {
    let repo = open_git2(repo_path)?;
    let plan = build_combined_diff(&repo, shas, include_workdir)?;
    let files = diff_to_file_diffs(&plan.diff)?;
    Ok(CombinedDiff {
        kind: plan.kind,
        n_commits: plan.n_commits,
        include_workdir,
        shas: shas.to_vec(),
        files,
        rename_detection_skipped: plan.rename_detection_skipped,
    })
}

/// Metadata-only variant of [`combined_commit_diff`] (#178): identical
/// selection semantics, but the file rows carry no hunk bodies. The
/// inspector's file list + stat chips read only path / status / counts,
/// so this stops a 15K-file WIP diff from serialising every line across
/// the IPC boundary for a view that never displays them.
pub fn combined_commit_diff_summary(
    repo_path: &Path,
    shas: &[String],
    include_workdir: bool,
) -> Result<CombinedDiffSummary, BackendError> {
    let repo = open_git2(repo_path)?;
    let plan = build_combined_diff(&repo, shas, include_workdir)?;
    let files = diff_to_file_metas(&plan.diff)?;
    Ok(CombinedDiffSummary {
        kind: plan.kind,
        n_commits: plan.n_commits,
        include_workdir,
        shas: shas.to_vec(),
        files,
        rename_detection_skipped: plan.rename_detection_skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::FileStatus;
    use git2::{Repository, Signature};
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn threshold_boundary_keeps_detection_at_or_below_limit() {
        assert!(!should_skip_rename_detection(0));
        assert!(!should_skip_rename_detection(1));
        assert!(!should_skip_rename_detection(
            RENAME_DETECTION_DELTA_LIMIT - 1
        ));
        assert!(!should_skip_rename_detection(RENAME_DETECTION_DELTA_LIMIT));
    }

    #[test]
    fn threshold_boundary_skips_detection_above_limit() {
        assert!(should_skip_rename_detection(
            RENAME_DETECTION_DELTA_LIMIT + 1
        ));
        assert!(should_skip_rename_detection(usize::MAX));
    }

    fn commit_all(repo: &Repository, msg: &str, parent: Option<git2::Oid>) -> git2::Oid {
        let sig = Signature::now("t", "t@e").unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let parents: Vec<git2::Commit<'_>> = parent
            .into_iter()
            .map(|oid| repo.find_commit(oid).unwrap())
            .collect();
        let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
            .unwrap()
    }

    #[test]
    fn small_diff_keeps_renames_and_does_not_flag_skip() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        let body = "alpha\nbeta\ngamma\ndelta\n".repeat(8);
        fs::write(dir.path().join("a.txt"), &body).unwrap();
        let first = commit_all(&repo, "add a", None);

        fs::remove_file(dir.path().join("a.txt")).unwrap();
        fs::write(dir.path().join("b.txt"), &body).unwrap();
        let second = commit_all(&repo, "rename a -> b", Some(first));

        let diff = commit_diff(dir.path(), &second.to_string()).unwrap();
        assert_eq!(diff.files.len(), 1, "rename should collapse to one entry");
        assert!(matches!(
            diff.files[0].status,
            FileStatus::Renamed | FileStatus::Copied
        ));

        let combined = combined_commit_diff(dir.path(), &[second.to_string()], false).unwrap();
        assert!(!combined.rename_detection_skipped);
        assert_eq!(combined.files.len(), 1);
        assert!(matches!(
            combined.files[0].status,
            FileStatus::Renamed | FileStatus::Copied
        ));
    }

    /// The summary must agree with the full diff on every metadata field —
    /// same files, same status, same add/del counts — while carrying no
    /// hunks. If the shared `delta_meta` core ever drifts, this catches it.
    #[test]
    fn summary_matches_full_metadata_without_hunks() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        fs::write(dir.path().join("a.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(dir.path().join("keep.txt"), "x\n").unwrap();
        let first = commit_all(&repo, "seed", None);

        // Modify a.txt (adds + deletions) and add a new file.
        fs::write(dir.path().join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        fs::write(dir.path().join("b.txt"), "new\n").unwrap();
        let second = commit_all(&repo, "edit + add", Some(first));

        let full = combined_commit_diff(dir.path(), &[second.to_string()], false).unwrap();
        let summary =
            combined_commit_diff_summary(dir.path(), &[second.to_string()], false).unwrap();

        assert_eq!(summary.kind as u8, full.kind as u8);
        assert_eq!(summary.n_commits, full.n_commits);
        assert_eq!(summary.shas, full.shas);
        assert_eq!(summary.files.len(), full.files.len());
        assert!(
            full.files.iter().any(|f| !f.hunks.is_empty()),
            "fixture should have hunks"
        );

        for meta in &summary.files {
            let full_file = full
                .files
                .iter()
                .find(|f| f.path == meta.path)
                .expect("summary path must exist in the full diff");
            assert_eq!(meta.status as u8, full_file.status as u8, "{}", meta.path);
            assert_eq!(meta.additions, full_file.additions, "adds {}", meta.path);
            assert_eq!(meta.deletions, full_file.deletions, "dels {}", meta.path);
            assert_eq!(meta.is_binary, full_file.is_binary, "{}", meta.path);
            assert_eq!(meta.old_mode, full_file.old_mode, "{}", meta.path);
        }
    }

    /// Empty selection with no workdir is a programming error on both
    /// entry points — the guard lives in the shared builder.
    #[test]
    fn summary_rejects_empty_selection() {
        let dir = TempDir::new().unwrap();
        Repository::init(dir.path()).unwrap();
        assert!(combined_commit_diff_summary(dir.path(), &[], false).is_err());
    }
}
