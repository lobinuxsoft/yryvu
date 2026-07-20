// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::{BackendError, MergeResult, MergeStrategy};
use crate::undo_log::{record_op_best_effort, OpKind};

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
            // Order matters, but only because this checkout is SAFE.
            //
            // libgit2 defaults the checkout baseline to HEAD's tree. Moving
            // the ref first makes baseline == target — the diff is not empty
            // (checkout.c carries GIT_DIFF_INCLUDE_UNMODIFIED, so every path
            // still yields a delta), but each one comes out UNMODIFIED, and
            // the UNMODIFIED arm is `CHECKOUT_ACTION_IF(FORCE, UPDATE_BLOB,
            // NONE)`. Without FORCE that resolves to NONE: nothing is
            // written, the working tree silently keeps the pre-merge content
            // while HEAD advances, and the index reads as a full revert of
            // everything the fast-forward brought in (#447).
            //
            // The rule is therefore: **ref-first is a silent no-op iff the
            // checkout is SAFE.** With FORCE the same ordering degenerates
            // into a correct `reset --hard` (UPDATE_BLOB on the UNMODIFIED
            // arm, tracked-but-not-in-target removed, missing files restored
            // through the RECREATE_MISSING that FORCE implies). That is why
            // `rebase/interactive/refs.rs` may move the ref before its
            // checkout and is not this bug.
            //
            // `.safe()` here is load-bearing in the other direction too: a
            // fast-forward must refuse to clobber uncommitted local changes,
            // which is exactly what `fast_forward_preserves_unrelated_local_
            // changes` pins. Do not "fix" it to `.force()`.
            //
            // So: checkout first (baseline still the old HEAD), then move
            // the ref.
            let obj = repo.find_object(source_oid, None).map_err(git2_err)?;
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout.safe();
            repo.checkout_tree(&obj, Some(&mut checkout))
                .map_err(git2_err)?;
            let mut head_ref_mut = repo.find_reference(&head_ref_name).map_err(git2_err)?;
            head_ref_mut
                .set_target(source_oid, "yryvu: fast-forward")
                .map_err(git2_err)?;
            record_op_best_effort(
                repo_path,
                OpKind::Merge {
                    source: source.to_string(),
                    pre_merge_sha: head_oid.to_string(),
                    post_merge_sha: source_oid.to_string(),
                },
            );
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
                // (via editor + staging, or via Yryvu's future conflict
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
            record_op_best_effort(
                repo_path,
                OpKind::Merge {
                    source: source.to_string(),
                    pre_merge_sha: head_oid.to_string(),
                    post_merge_sha: commit_oid.to_string(),
                },
            );
            Ok(MergeResult::Merged {
                new_head: commit_oid.to_string(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    /// Init a repo with a committed identity. The env vars above only reach
    /// the git CLI — `merge_branch` builds its signature through libgit2,
    /// which reads the config, and CI runners have no global user.name.
    fn init_repo(repo: &Path) {
        git(repo, &["init", "-q", "-b", "main"]);
        git(repo, &["config", "user.name", "t"]);
        git(repo, &["config", "user.email", "t@t"]);
    }

    /// A fast-forward must leave unrelated local work alone — git's own
    /// `merge --ff` only refuses when the incoming changes would clobber a
    /// dirty path.
    #[test]
    fn fast_forward_preserves_unrelated_local_changes() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        init_repo(p);
        std::fs::write(p.join("a.txt"), "v1\n").unwrap();
        std::fs::write(p.join("mine.txt"), "v1\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "init"]);
        git(p, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(p.join("a.txt"), "v2-from-teammate\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "teammate work"]);
        git(p, &["checkout", "-q", "main"]);

        // Uncommitted local edit on a file the fast-forward never touches.
        std::fs::write(p.join("mine.txt"), "work in progress\n").unwrap();

        merge_branch(p, "feature", MergeStrategy::FastForwardOrMerge).unwrap();

        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "v2-from-teammate\n",
            "fast-forward did not land the incoming change"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("mine.txt")).unwrap(),
            "work in progress\n",
            "fast-forward clobbered unrelated local work"
        );
    }

    /// Regression: the fast-forward used to move the ref before checking out,
    /// which made libgit2's baseline (HEAD's tree) equal the target — the
    /// diff came out empty, the working tree kept the pre-merge content, and
    /// the index read as a staged revert of the whole incoming change.
    #[test]
    fn fast_forward_updates_working_tree_and_index() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        init_repo(p);
        std::fs::write(p.join("a.txt"), "v1\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "init"]);
        git(p, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(p.join("a.txt"), "v2-from-teammate\n").unwrap();
        std::fs::write(p.join("b.txt"), "new file\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "teammate work"]);
        git(p, &["checkout", "-q", "main"]);

        let res = merge_branch(p, "feature", MergeStrategy::FastForwardOrMerge).unwrap();
        println!("merge result: {res:?}");

        let a = std::fs::read_to_string(p.join("a.txt")).unwrap();
        let b_exists = p.join("b.txt").exists();
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(p)
            .output()
            .unwrap();
        println!("a.txt = {a:?}, b.txt exists = {b_exists}");
        println!("status: {:?}", String::from_utf8_lossy(&status.stdout));

        assert_eq!(a, "v2-from-teammate\n", "working tree kept the OLD content");
        assert!(b_exists, "new file from teammate never landed on disk");
        assert!(status.stdout.is_empty(), "working tree dirty after FF");
    }

    #[test]
    fn conflict_writes_markers_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        init_repo(p);
        std::fs::write(p.join("a.txt"), "v1\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "init"]);
        git(p, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(p.join("a.txt"), "theirs\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "theirs"]);
        git(p, &["checkout", "-q", "main"]);
        std::fs::write(p.join("a.txt"), "ours\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "ours"]);

        let res = merge_branch(p, "feature", MergeStrategy::FastForwardOrMerge);
        println!("merge result: {res:?}");
        let a = std::fs::read_to_string(p.join("a.txt")).unwrap();
        println!("a.txt on disk =\n{a}");
        assert!(
            a.contains("<<<<<<<"),
            "no conflict markers on disk — user resolves blind"
        );
    }

    #[test]
    fn merge_commit_updates_working_tree() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        init_repo(p);
        std::fs::write(p.join("a.txt"), "v1\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "init"]);
        git(p, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(p.join("b.txt"), "teammate\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "teammate work"]);
        git(p, &["checkout", "-q", "main"]);
        std::fs::write(p.join("c.txt"), "mine\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "my work"]);

        let res = merge_branch(p, "feature", MergeStrategy::FastForwardOrMerge).unwrap();
        println!("merge result: {res:?}");
        let b_exists = p.join("b.txt").exists();
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(p)
            .output()
            .unwrap();
        println!("b.txt exists = {b_exists}");
        println!("status: {:?}", String::from_utf8_lossy(&status.stdout));
        assert!(b_exists, "merged file never landed on disk");
        assert!(status.stdout.is_empty(), "working tree dirty after merge");
    }
}
