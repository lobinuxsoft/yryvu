// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;

use super::super::common::{git2_err, open_git2};
use super::sign;
use super::types::CommitOptions;

/// Compose the final commit message from `summary` + optional `description`
/// with a blank-line separator. Strips trailing whitespace off each side;
/// returns `None` if the summary is empty after trimming.
fn compose_message(summary: &str, description: &str) -> Option<String> {
    let summary = summary.trim();
    if summary.is_empty() {
        return None;
    }
    let description = description.trim();
    if description.is_empty() {
        Some(summary.to_string())
    } else {
        Some(format!("{summary}\n\n{description}"))
    }
}

/// Read the other parent(s) of an in-progress merge from `.git/MERGE_HEAD`.
/// Git does not infer a merge from anything — the commit object has to list
/// the parent, so a commit written while `MERGE_HEAD` exists must pick it up
/// or the merge silently never happened. One oid per line (an octopus merge
/// records several).
fn merge_heads(repo: &git2::Repository) -> Result<Vec<git2::Oid>, BackendError> {
    let path = repo.path().join("MERGE_HEAD");
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| git2::Oid::from_str(line).map_err(git2_err))
        .collect()
}

/// Write a new commit (or amend HEAD) with the bundled options.
///
/// When a merge is in progress, the other parent is read from `MERGE_HEAD`
/// and the merge state is cleared afterwards. Without that, resolving
/// conflicts by hand and committing from the staging panel produced a
/// single-parent commit: the tree looked right, but git considered the
/// branch unmerged and the incoming history was stranded.
///
/// BACKEND: git2 — needs `index.write_tree()` to materialise the staged
/// tree before the commit object. gix 0.68 / gix-index 0.37 read the
/// index but don't expose a state→tree writer yet. Migrate to
/// `gix::Repository::commit_as()` once gix-index gains a `write_tree`
/// equivalent.
pub fn create_commit(repo_path: &Path, opts: &CommitOptions) -> Result<String, BackendError> {
    let message = compose_message(&opts.summary, &opts.description)
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("commit message cannot be empty")))?;

    let repo = open_git2(repo_path)?;
    let signature = opts.signature(&repo).map_err(git2_err)?;

    let mut index = repo.index().map_err(git2_err)?;
    // write_tree() fails on an unmerged index with a raw `code=Unmerged
    // (-10)`, which reaches the toast verbatim. Say what to do instead.
    if index.has_conflicts() {
        return Err(BackendError::Git(anyhow::anyhow!(
            "cannot commit with unresolved conflicts — resolve the conflicting paths and stage \
             them, or abort the operation"
        )));
    }
    let tree_oid = index.write_tree().map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;

    if opts.amend {
        let head = repo
            .head()
            .map_err(|_| BackendError::Git(anyhow::anyhow!("cannot amend: no HEAD commit")))?;
        let head_commit = head.peel_to_commit().map_err(git2_err)?;
        let old_sha = head_commit.id().to_string();

        let new_oid = if opts.gpg_sign {
            let parents: Vec<git2::Commit> = (0..head_commit.parent_count())
                .filter_map(|i| head_commit.parent(i).ok())
                .collect();
            let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
            write_signed_commit(&repo, &signature, &message, &tree, &parent_refs)?
        } else {
            head_commit
                .amend(
                    Some("HEAD"),
                    None,
                    Some(&signature),
                    None,
                    Some(&message),
                    Some(&tree),
                )
                .map_err(git2_err)?
        };
        if opts.gpg_sign {
            move_head_to(&repo, new_oid, "yryvu: amend (signed)")?;
        }
        let new_sha = new_oid.to_string();
        crate::undo_log::record_op_best_effort(
            repo_path,
            crate::undo_log::OpKind::Amend {
                old_sha,
                new_sha: new_sha.clone(),
            },
        );
        return Ok(new_sha);
    }

    let mut parents: Vec<git2::Commit> = match repo.head().ok() {
        Some(head) => {
            let commit = head.peel_to_commit().map_err(git2_err)?;
            vec![commit]
        }
        None => Vec::new(),
    };
    let parent_sha = parents.first().map(|c| c.id().to_string());

    // A merge in progress contributes its other parent(s). Resolve them
    // before writing anything, so a bad MERGE_HEAD aborts instead of
    // leaving a half-made commit behind.
    let merge_heads = merge_heads(&repo)?;
    for oid in &merge_heads {
        parents.push(repo.find_commit(*oid).map_err(git2_err)?);
    }
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let new_oid = if opts.gpg_sign {
        let oid = write_signed_commit(&repo, &signature, &message, &tree, &parent_refs)?;
        move_head_to(&repo, oid, "yryvu: commit (signed)")?;
        oid
    } else {
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parent_refs,
        )
        .map_err(git2_err)?
    };
    let new_sha = new_oid.to_string();

    // The merge is committed, so drop MERGE_HEAD / MERGE_MSG. Left behind,
    // `repo.state()` reports Merge forever and the next `git commit` from a
    // terminal grafts this stale parent onto an unrelated commit. Gated on
    // an actual merge: cleanup_state() also clears rebase / cherry-pick
    // state, and a git-CLI rebase running alongside us must survive.
    if !merge_heads.is_empty() {
        repo.cleanup_state().map_err(git2_err)?;
    }

    crate::undo_log::record_op_best_effort(
        repo_path,
        crate::undo_log::OpKind::Commit {
            sha: new_sha.clone(),
            parent_sha,
        },
    );

    Ok(new_sha)
}

/// Build the commit content via `commit_create_buffer`, shell out to
/// gpg / ssh-keygen for the signature, then materialise the new commit
/// with `commit_signed`. The caller updates HEAD afterwards (libgit2's
/// signed-commit path does not advance any ref).
fn write_signed_commit(
    repo: &git2::Repository,
    signature: &git2::Signature<'_>,
    message: &str,
    tree: &git2::Tree<'_>,
    parents: &[&git2::Commit<'_>],
) -> Result<git2::Oid, BackendError> {
    let buf = repo
        .commit_create_buffer(signature, signature, message, tree, parents)
        .map_err(git2_err)?;
    let content = std::str::from_utf8(&buf)
        .map_err(|e| BackendError::Git(anyhow::anyhow!("commit buffer not valid utf-8: {e}")))?;
    let sig = sign::sign_bytes(repo, content.as_bytes())?;
    repo.commit_signed(content, &sig, Some("gpgsig"))
        .map_err(git2_err)
}

/// Force HEAD (and its currently-checked-out branch ref, if any) to
/// point at `oid`. Used after `commit_signed`, which writes the commit
/// object but does not advance any ref.
fn move_head_to(
    repo: &git2::Repository,
    oid: git2::Oid,
    reflog_msg: &str,
) -> Result<(), BackendError> {
    match repo.head() {
        // Born branch: HEAD resolves to `refs/heads/<name>` — move it.
        Ok(r) if r.is_branch() => {
            let mut branch_ref = repo
                .find_reference(r.name().unwrap_or("HEAD"))
                .map_err(git2_err)?;
            branch_ref.set_target(oid, reflog_msg).map_err(git2_err)?;
        }
        // Detached HEAD: HEAD is itself a direct ref — point it at `oid`.
        Ok(_) => {
            repo.reference("HEAD", oid, true, reflog_msg)
                .map_err(git2_err)?;
        }
        // Unborn branch: `git_repository_head` errors, but HEAD is a symref
        // to a branch that does not exist yet. Create that branch at `oid`
        // and leave HEAD symbolic — mirroring the unsigned path's
        // `repo.commit(Some("HEAD"), ...)`, which resolves the symref and
        // births the branch. Overwriting HEAD with a direct ref instead
        // (the old `_` arm) detaches HEAD on the very first signed commit.
        Err(_) => {
            let head = repo.find_reference("HEAD").map_err(git2_err)?;
            match head.symbolic_target() {
                Some(target) => {
                    repo.reference(target, oid, true, reflog_msg)
                        .map_err(git2_err)?;
                }
                // HEAD is not symbolic and could not be resolved: nothing
                // sensible to birth, so fall back to a direct HEAD ref.
                None => {
                    repo.reference("HEAD", oid, true, reflog_msg)
                        .map_err(git2_err)?;
                }
            }
        }
    }
    Ok(())
}

/// GitKraken's one-shot `Commit and Push`: write the commit, then push
/// HEAD's branch to its upstream. The commit is already durable if the
/// push fails, so the caller can retry the push alone.
///
/// BACKEND: git2 (transitively) — see `create_commit` and
/// `push_current_branch` for individual migration blockers.
pub fn commit_and_push(repo_path: &Path, opts: &CommitOptions) -> Result<String, BackendError> {
    let new_sha = create_commit(repo_path, opts)?;
    super::super::remote::push_current_branch(repo_path, crate::backend::PushOptions::default())?;
    Ok(new_sha)
}

pub fn head_commit_message(repo_path: &Path) -> Result<String, BackendError> {
    let repo = open_git2(repo_path)?;
    let head = repo
        .head()
        .map_err(|_| BackendError::Git(anyhow::anyhow!("no HEAD commit")))?;
    let head_commit = head.peel_to_commit().map_err(git2_err)?;
    Ok(head_commit.message().unwrap_or_default().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(repo)
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn out(repo: &Path, args: &[&str]) -> String {
        String::from_utf8(
            Command::new("git")
                .args(args)
                .current_dir(repo)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string()
    }

    /// `main` and `feature` both touch a.txt from a shared base, so merging
    /// them conflicts. Returns the repo path and `feature`'s tip.
    fn conflicted_merge_in_progress() -> (tempfile::TempDir, std::path::PathBuf, String) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_path_buf();
        git(&p, &["init", "-q", "-b", "main"]);
        git(&p, &["config", "user.name", "t"]);
        git(&p, &["config", "user.email", "t@t"]);
        std::fs::write(p.join("a.txt"), "base\n").unwrap();
        git(&p, &["add", "."]);
        git(&p, &["commit", "-qm", "base"]);

        git(&p, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(p.join("a.txt"), "theirs\n").unwrap();
        git(&p, &["add", "."]);
        git(&p, &["commit", "-qm", "teammate work"]);
        let their_sha = out(&p, &["rev-parse", "HEAD"]);

        git(&p, &["checkout", "-q", "main"]);
        std::fs::write(p.join("a.txt"), "ours\n").unwrap();
        git(&p, &["add", "."]);
        git(&p, &["commit", "-qm", "my work"]);

        let res = crate::repo::merge::merge_branch(
            &p,
            "feature",
            crate::backend::MergeStrategy::FastForwardOrMerge,
        )
        .unwrap();
        assert!(matches!(res, crate::backend::MergeResult::Conflict { .. }));
        (dir, p, their_sha)
    }

    /// The user resolves the conflict in their editor and commits from the
    /// staging panel — never opening the conflict resolver. The result must
    /// still be a real merge commit, or git considers the branch unmerged
    /// and the teammate's history is stranded.
    #[test]
    fn commit_during_merge_keeps_both_parents_and_clears_state() {
        let (_d, p, their_sha) = conflicted_merge_in_progress();

        std::fs::write(p.join("a.txt"), "resolved by hand\n").unwrap();
        super::super::stage::stage_files(&p, &["a.txt".to_string()]).unwrap();

        let sha = create_commit(
            &p,
            &CommitOptions {
                summary: "Merge feature into main".to_string(),
                ..CommitOptions::default()
            },
        )
        .unwrap();

        let parents = out(&p, &["rev-list", "--parents", "-n", "1", &sha]);
        let parent_count = parents.split_whitespace().count() - 1;
        assert_eq!(parent_count, 2, "merge commit lost its second parent");

        // The teammate's work must be reachable, or `git branch --merged`
        // omits feature and a later merge re-conflicts from the old base.
        let reachable = Command::new("git")
            .args(["merge-base", "--is-ancestor", &their_sha, "HEAD"])
            .current_dir(&p)
            .status()
            .unwrap()
            .success();
        assert!(reachable, "teammate's work is not in history");

        assert!(
            !p.join(".git/MERGE_HEAD").exists(),
            "MERGE_HEAD left behind — the repo still thinks it is merging, and the next \
             CLI commit would graft a stale second parent onto it"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "resolved by hand\n",
            "the resolved content is not what got committed"
        );
    }

    /// Committing with the index still conflicted must fail with something
    /// legible, not libgit2's raw `code=Unmerged (-10)`.
    #[test]
    fn commit_with_unresolved_conflicts_is_refused_legibly() {
        let (_d, p, _) = conflicted_merge_in_progress();

        let err = create_commit(
            &p,
            &CommitOptions {
                summary: "premature".to_string(),
                ..CommitOptions::default()
            },
        )
        .unwrap_err();

        let msg = format!("{err}");
        println!("error: {msg}");
        assert!(
            msg.to_lowercase().contains("conflict"),
            "expected a legible conflict error, got: {msg}"
        );
    }

    /// An ordinary commit outside a merge must stay single-parent.
    #[test]
    fn ordinary_commit_is_unaffected() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        git(p, &["config", "user.name", "t"]);
        git(p, &["config", "user.email", "t@t"]);
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "first"]);

        std::fs::write(p.join("a.txt"), "two\n").unwrap();
        super::super::stage::stage_files(p, &["a.txt".to_string()]).unwrap();
        let sha = create_commit(
            p,
            &CommitOptions {
                summary: "second".to_string(),
                ..CommitOptions::default()
            },
        )
        .unwrap();

        let parents = out(p, &["rev-list", "--parents", "-n", "1", &sha]);
        assert_eq!(parents.split_whitespace().count() - 1, 1);
    }

    /// The signed path advances HEAD via `move_head_to` (the unsigned path
    /// lets `repo.commit(Some("HEAD"), ...)` do it). On an unborn branch the
    /// old code overwrote HEAD with a direct ref → the first signed commit
    /// detached HEAD and never created `refs/heads/main`. `move_head_to` is
    /// GPG-agnostic, so an unsigned commit object exercises the same arm
    /// without needing a signing key in the fixture.
    #[test]
    fn signed_first_commit_on_unborn_head_births_the_branch() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        git(p, &["config", "user.name", "t"]);
        git(p, &["config", "user.email", "t@t"]);
        std::fs::write(p.join("a.txt"), "one\n").unwrap();

        // Build a commit object without touching any ref — what the signed
        // path does via `commit_signed` — then hand it to `move_head_to`.
        let repo = open_git2(p).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        let oid = repo
            .commit(None, &sig, &sig, "initial", &tree, &[])
            .unwrap();

        move_head_to(&repo, oid, "yryvu: commit (signed)").unwrap();

        assert_eq!(
            out(p, &["rev-parse", "refs/heads/main"]),
            oid.to_string(),
            "refs/heads/main was never created — the commit is orphaned"
        );
        assert_eq!(
            std::fs::read_to_string(p.join(".git/HEAD")).unwrap().trim(),
            "ref: refs/heads/main",
            "HEAD detached on the first signed commit"
        );
    }
}
