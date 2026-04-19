// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::{BackendError, MergeResult, MergeStrategy};

use super::common::{git2_err, open_git2, short_sha};

pub fn merge_branch(
    repo_path: &Path,
    source: &str,
    strategy: MergeStrategy,
) -> Result<MergeResult, BackendError> {
    let repo = open_git2(repo_path)?;

    let source_obj = repo
        .revparse_single(source)
        .map_err(git2_err)?
        .peel_to_commit()
        .map_err(git2_err)?;
    let source_oid = source_obj.id();

    let head_ref = repo.head().map_err(git2_err)?;
    let head_oid = head_ref
        .target()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("HEAD has no direct target")))?;

    let annotated = repo.find_annotated_commit(source_oid).map_err(git2_err)?;
    let (analysis, _prefs) = repo.merge_analysis(&[&annotated]).map_err(git2_err)?;

    if analysis.is_up_to_date() {
        return Ok(MergeResult::AlreadyUpToDate);
    }

    let can_ff = analysis.is_fast_forward();

    match strategy {
        MergeStrategy::FastForwardOnly if !can_ff => Err(BackendError::NotFastForward),
        MergeStrategy::FastForwardOnly | MergeStrategy::FastForwardOrMerge if can_ff => {
            let head_ref_name = head_ref
                .name()
                .ok_or_else(|| BackendError::Git(anyhow::anyhow!("HEAD is not symbolic")))?
                .to_string();
            let mut head_ref_mut = repo.find_reference(&head_ref_name).map_err(git2_err)?;
            head_ref_mut
                .set_target(source_oid, "chaja: fast-forward")
                .map_err(git2_err)?;
            let obj = repo.find_object(source_oid, None).map_err(git2_err)?;
            repo.checkout_tree(&obj, None).map_err(git2_err)?;
            Ok(MergeResult::FastForward {
                new_head: source_oid.to_string(),
            })
        }
        _ => {
            // Non-fast-forward: produce a merge commit.
            let head_commit = repo.find_commit(head_oid).map_err(git2_err)?;
            let their_commit = repo.find_commit(source_oid).map_err(git2_err)?;

            repo.merge(&[&annotated], None, None).map_err(git2_err)?;

            let mut idx = repo.index().map_err(git2_err)?;
            if idx.has_conflicts() {
                let paths: Vec<String> = idx
                    .conflicts()
                    .map_err(git2_err)?
                    .filter_map(|c| c.ok())
                    .filter_map(|c| c.our.or(c.their).or(c.ancestor))
                    .map(|e| String::from_utf8_lossy(&e.path).into_owned())
                    .collect();
                // Do NOT call cleanup_state here — leave the repo in a
                // merge-in-progress state so the user can resolve conflicts
                // (via editor + staging, or via Chajá's future conflict
                // resolver — issue #10) or explicitly abort via abort_merge.
                return Ok(MergeResult::Conflict { paths });
            }

            let tree_oid = idx.write_tree_to(&repo).map_err(git2_err)?;
            let tree = repo.find_tree(tree_oid).map_err(git2_err)?;
            let signature = repo.signature().map_err(git2_err)?;
            let short = short_sha(&source_oid);
            let message = format!("Merge {source} ({short}) into HEAD");
            let commit_oid = repo
                .commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    &message,
                    &tree,
                    &[&head_commit, &their_commit],
                )
                .map_err(git2_err)?;
            repo.cleanup_state().map_err(git2_err)?;
            Ok(MergeResult::Merged {
                new_head: commit_oid.to_string(),
            })
        }
    }
}
