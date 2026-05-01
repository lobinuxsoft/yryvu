// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::anyhow;

use crate::backend::{BackendError, CombinedDiff, CombinedDiffKind, CommitDiff};

use super::super::common::{diff_to_file_diffs, git2_err, open_git2};

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
