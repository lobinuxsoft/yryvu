// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::{anyhow, Context};
use graph_core::{Commit, RefTag};

use crate::backend::{
    BackendError, BranchInfo, BranchKind, GitBackend, MergeResult, MergeStrategy, RepoStateInfo,
};

#[derive(Debug, Default, Clone, Copy)]
pub struct GixBackend;

impl GitBackend for GixBackend {
    fn walk_commits(
        &self,
        repo_path: &Path,
    ) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
        let repo = open_repo(repo_path)?;

        let head_id = repo
            .head_id()
            .context("resolve HEAD")
            .map_err(BackendError::Revwalk)?;

        let walk = repo
            .rev_walk(Some(head_id))
            .sorting(gix::revision::walk::Sorting::ByCommitTime(
                gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
            ))
            .all()
            .context("start revwalk")
            .map_err(BackendError::Revwalk)?;

        // Collect eagerly for a first cut. Streaming via Tauri events happens at the
        // commands layer — this iterator feeds into the lane assigner synchronously.
        let mut commits = Vec::new();
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

            commits.push(Ok(Commit {
                sha: info.id.to_string(),
                parents,
                summary,
                author: author_line,
                author_date: time.seconds,
                refs: Vec::<RefTag>::new(),
            }));
        }

        Ok(Box::new(commits.into_iter()))
    }

    fn list_branches(&self, repo_path: &Path) -> Result<Vec<BranchInfo>, BackendError> {
        let repo = open_repo(repo_path)?;
        let head_full = repo
            .head_name()
            .ok()
            .flatten()
            .map(|n| n.as_bstr().to_string());

        let mut out = Vec::new();

        let platform = repo
            .references()
            .context("open references platform")
            .map_err(BackendError::Branch)?;

        // Local branches
        for reference in platform
            .local_branches()
            .context("iterate local branches")
            .map_err(BackendError::Branch)?
        {
            let mut reference = reference
                .map_err(|e| BackendError::Branch(anyhow!("resolve local branch: {e}")))?;
            let full_name = reference.name().as_bstr().to_string();
            let short = reference.name().shorten().to_string();
            let tip = reference
                .peel_to_id_in_place()
                .context("peel local branch tip")
                .map_err(BackendError::Branch)?;
            let tip_sha = tip.to_string();
            let is_head = head_full.as_deref() == Some(full_name.as_str());

            let (upstream, ahead, behind) = match upstream_for(&repo, &short) {
                Ok(Some((upstream_short, upstream_id))) => {
                    let (a, b) = ahead_behind(&repo, tip.detach(), upstream_id).unwrap_or((0, 0));
                    (Some(upstream_short), a, b)
                }
                _ => (None, 0, 0),
            };

            out.push(BranchInfo {
                name: short,
                full_name,
                kind: BranchKind::Local,
                tip_sha,
                is_head,
                upstream,
                ahead,
                behind,
            });
        }

        // Remote-tracking branches
        for reference in platform
            .remote_branches()
            .context("iterate remote branches")
            .map_err(BackendError::Branch)?
        {
            let mut reference = reference
                .map_err(|e| BackendError::Branch(anyhow!("resolve remote branch: {e}")))?;
            let full_name = reference.name().as_bstr().to_string();
            let short = reference.name().shorten().to_string();
            // Skip symbolic HEAD pointers like refs/remotes/origin/HEAD.
            if short.ends_with("/HEAD") {
                continue;
            }
            let tip = reference
                .peel_to_id_in_place()
                .context("peel remote branch tip")
                .map_err(BackendError::Branch)?;
            out.push(BranchInfo {
                name: short,
                full_name,
                kind: BranchKind::Remote,
                tip_sha: tip.to_string(),
                is_head: false,
                upstream: None,
                ahead: 0,
                behind: 0,
            });
        }

        out.sort_by(|a, b| (a.kind_sort_key(), &a.name).cmp(&(b.kind_sort_key(), &b.name)));
        Ok(out)
    }

    fn create_branch(
        &self,
        repo_path: &Path,
        name: &str,
        from: Option<&str>,
    ) -> Result<(), BackendError> {
        validate_branch_name(name)?;
        let repo = open_repo(repo_path)?;

        let target = match from {
            Some(spec) => repo
                .rev_parse_single(spec.as_bytes())
                .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?
                .detach(),
            None => repo
                .head_id()
                .context("resolve HEAD")
                .map_err(BackendError::Branch)?
                .detach(),
        };

        let full_name = format!("refs/heads/{name}");

        // Check for pre-existence to return a typed error instead of a gix transaction error.
        if repo.find_reference(full_name.as_str()).is_ok() {
            return Err(BackendError::BranchExists {
                name: name.to_string(),
            });
        }

        repo.reference(
            full_name.as_str(),
            target,
            gix::refs::transaction::PreviousValue::MustNotExist,
            format!("chaja: create branch {name}"),
        )
        .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?;

        Ok(())
    }

    fn delete_local_branch(
        &self,
        repo_path: &Path,
        name: &str,
        force: bool,
    ) -> Result<(), BackendError> {
        let repo = open_repo(repo_path)?;
        let full_name = format!("refs/heads/{name}");

        let mut reference =
            repo.find_reference(full_name.as_str())
                .map_err(|_| BackendError::BranchNotFound {
                    name: name.to_string(),
                })?;

        // Refuse to delete the currently checked-out branch.
        if let Some(head) = repo.head_name().ok().flatten() {
            if head.as_bstr() == reference.name().as_bstr() {
                return Err(BackendError::Branch(anyhow!(
                    "cannot delete the currently checked-out branch '{name}'"
                )));
            }
        }

        if !force {
            let tip = reference
                .peel_to_id_in_place()
                .context("peel branch tip")
                .map_err(BackendError::Branch)?
                .detach();
            let head = repo
                .head_id()
                .context("resolve HEAD")
                .map_err(BackendError::Branch)?
                .detach();
            if !is_ancestor(&repo, tip, head) {
                return Err(BackendError::BranchUnmerged {
                    name: name.to_string(),
                });
            }
        }

        reference
            .delete()
            .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?;

        Ok(())
    }

    fn rename_branch(
        &self,
        repo_path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), BackendError> {
        validate_branch_name(new_name)?;
        let repo = open_repo(repo_path)?;

        let old_full = format!("refs/heads/{old_name}");
        let new_full = format!("refs/heads/{new_name}");

        let mut reference =
            repo.find_reference(old_full.as_str())
                .map_err(|_| BackendError::BranchNotFound {
                    name: old_name.to_string(),
                })?;

        if repo.find_reference(new_full.as_str()).is_ok() {
            return Err(BackendError::BranchExists {
                name: new_name.to_string(),
            });
        }

        let tip = reference
            .peel_to_id_in_place()
            .context("peel branch tip")
            .map_err(BackendError::Branch)?
            .detach();

        // Create the new ref, then delete the old one.
        repo.reference(
            new_full.as_str(),
            tip,
            gix::refs::transaction::PreviousValue::MustNotExist,
            format!("chaja: rename {old_name} -> {new_name}"),
        )
        .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?;

        reference
            .delete()
            .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?;

        Ok(())
    }

    fn is_working_tree_dirty(&self, repo_path: &Path) -> Result<bool, BackendError> {
        let repo = open_git2(repo_path)?;
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true);
        opts.recurse_untracked_dirs(true);
        let statuses = repo.statuses(Some(&mut opts)).map_err(git2_err)?;
        Ok(!statuses.is_empty())
    }

    fn checkout_branch(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        let repo = open_git2(repo_path)?;
        let full_name = format!("refs/heads/{name}");

        repo.find_reference(&full_name)
            .map_err(|_| BackendError::BranchNotFound {
                name: name.to_string(),
            })?;

        let obj = repo.revparse_single(&full_name).map_err(git2_err)?;

        // Default checkout is safe: it refuses when the working tree would lose
        // uncommitted changes. The UI is expected to call is_working_tree_dirty
        // first and prompt the user.
        repo.checkout_tree(&obj, None).map_err(git2_err)?;
        repo.set_head(&full_name).map_err(git2_err)?;
        Ok(())
    }

    fn stash_push(&self, repo_path: &Path, message: Option<&str>) -> Result<(), BackendError> {
        let mut repo = open_git2(repo_path)?;
        let signature = repo.signature().map_err(git2_err)?;
        let flags = git2::StashFlags::DEFAULT | git2::StashFlags::INCLUDE_UNTRACKED;
        repo.stash_save2(&signature, message, Some(flags))
            .map_err(git2_err)?;
        Ok(())
    }

    fn stash_pop(&self, repo_path: &Path) -> Result<(), BackendError> {
        let mut repo = open_git2(repo_path)?;
        repo.stash_pop(0, None).map_err(git2_err)?;
        Ok(())
    }

    fn merge_branch(
        &self,
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

    fn delete_remote_branch(
        &self,
        repo_path: &Path,
        remote: &str,
        name: &str,
    ) -> Result<(), BackendError> {
        let repo = open_git2(repo_path)?;
        let mut remote_obj =
            repo.find_remote(remote)
                .map_err(|_| BackendError::RemoteNotFound {
                    name: remote.to_string(),
                })?;

        let refspec = format!(":refs/heads/{name}");

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|url, username_from_url, allowed| {
            if allowed.contains(git2::CredentialType::SSH_KEY) {
                let user = username_from_url.unwrap_or("git");
                if let Ok(cred) = git2::Cred::ssh_key_from_agent(user) {
                    return Ok(cred);
                }
            }
            if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
                if let Ok(cfg) = git2::Config::open_default() {
                    if let Ok(cred) = git2::Cred::credential_helper(&cfg, url, username_from_url) {
                        return Ok(cred);
                    }
                }
            }
            if allowed.contains(git2::CredentialType::DEFAULT) {
                if let Ok(cred) = git2::Cred::default() {
                    return Ok(cred);
                }
            }
            Err(git2::Error::from_str(
                "no credentials available (tried SSH agent, git credential helper, default)",
            ))
        });

        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);

        remote_obj
            .push(&[&refspec], Some(&mut push_opts))
            .map_err(|e| BackendError::PushFailed(e.to_string()))?;

        Ok(())
    }

    fn abort_merge(&self, repo_path: &Path) -> Result<(), BackendError> {
        let repo = open_git2(repo_path)?;
        // Reset hard to HEAD, then clean up MERGE_HEAD / MERGE_MSG.
        let head = repo.head().map_err(git2_err)?;
        let head_commit = head.peel_to_commit().map_err(git2_err)?;
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.force();
        repo.reset(
            head_commit.as_object(),
            git2::ResetType::Hard,
            Some(&mut checkout),
        )
        .map_err(git2_err)?;
        repo.cleanup_state().map_err(git2_err)?;
        Ok(())
    }

    fn repo_state(&self, repo_path: &Path) -> Result<RepoStateInfo, BackendError> {
        let repo = open_git2(repo_path)?;
        let state = repo.state();
        let kind = match state {
            git2::RepositoryState::Clean => "clean",
            git2::RepositoryState::Merge => "merge",
            git2::RepositoryState::Revert | git2::RepositoryState::RevertSequence => "revert",
            git2::RepositoryState::CherryPick | git2::RepositoryState::CherryPickSequence => {
                "cherry-pick"
            }
            git2::RepositoryState::Bisect => "bisect",
            git2::RepositoryState::Rebase
            | git2::RepositoryState::RebaseInteractive
            | git2::RepositoryState::RebaseMerge => "rebase",
            git2::RepositoryState::ApplyMailbox | git2::RepositoryState::ApplyMailboxOrRebase => {
                "apply-mailbox"
            }
        }
        .to_string();

        let conflict_paths = if state == git2::RepositoryState::Clean {
            Vec::new()
        } else {
            let idx = repo.index().map_err(git2_err)?;
            if idx.has_conflicts() {
                let mut paths: Vec<String> = idx
                    .conflicts()
                    .map_err(git2_err)?
                    .filter_map(|c| c.ok())
                    .filter_map(|c| c.our.or(c.their).or(c.ancestor))
                    .map(|e| String::from_utf8_lossy(&e.path).into_owned())
                    .collect();
                paths.sort();
                paths.dedup();
                paths
            } else {
                Vec::new()
            }
        };

        Ok(RepoStateInfo {
            kind,
            conflict_paths,
        })
    }
}

fn open_git2(path: &Path) -> Result<git2::Repository, BackendError> {
    git2::Repository::open(path).map_err(|e| BackendError::Open {
        path: path.display().to_string(),
        source: anyhow::Error::new(e),
    })
}

fn git2_err(e: git2::Error) -> BackendError {
    BackendError::Git(anyhow::Error::new(e))
}

fn short_sha(oid: &git2::Oid) -> String {
    oid.to_string().chars().take(7).collect()
}

fn open_repo(path: &Path) -> Result<gix::Repository, BackendError> {
    gix::open(path).map_err(|e| BackendError::Open {
        path: path.display().to_string(),
        source: anyhow::Error::new(e),
    })
}

fn validate_branch_name(name: &str) -> Result<(), BackendError> {
    if name.is_empty()
        || name.starts_with('-')
        || name.contains("..")
        || name.contains(' ')
        || name.contains('\t')
        || name.contains('~')
        || name.contains('^')
        || name.contains(':')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.contains('\\')
        || name.ends_with('/')
        || name.ends_with(".lock")
    {
        return Err(BackendError::InvalidBranchName {
            name: name.to_string(),
        });
    }
    Ok(())
}

/// Resolves the upstream short name and tip id for a local branch, consulting
/// `branch.<name>.remote` and `branch.<name>.merge` in the config.
fn upstream_for(
    repo: &gix::Repository,
    local_short: &str,
) -> anyhow::Result<Option<(String, gix::ObjectId)>> {
    let config = repo.config_snapshot();
    let remote_key = format!("branch.{local_short}.remote");
    let merge_key = format!("branch.{local_short}.merge");

    let remote = match config.string(remote_key.as_str()) {
        Some(v) => v.to_string(),
        None => return Ok(None),
    };
    let merge_ref = match config.string(merge_key.as_str()) {
        Some(v) => v.to_string(),
        None => return Ok(None),
    };

    let merge_short = merge_ref
        .strip_prefix("refs/heads/")
        .unwrap_or(merge_ref.as_str());
    let upstream_full = format!("refs/remotes/{remote}/{merge_short}");

    let mut reference = match repo.find_reference(upstream_full.as_str()) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    let id = reference
        .peel_to_id_in_place()
        .context("peel upstream tip")?
        .detach();
    Ok(Some((format!("{remote}/{merge_short}"), id)))
}

fn ahead_behind(
    repo: &gix::Repository,
    local: gix::ObjectId,
    upstream: gix::ObjectId,
) -> anyhow::Result<(u32, u32)> {
    let base = repo.merge_base(local, upstream)?.detach();
    let ahead = count_revs(repo, local, base)?;
    let behind = count_revs(repo, upstream, base)?;
    Ok((ahead, behind))
}

fn count_revs(
    repo: &gix::Repository,
    from: gix::ObjectId,
    excluding: gix::ObjectId,
) -> anyhow::Result<u32> {
    if from == excluding {
        return Ok(0);
    }
    let walk = repo
        .rev_walk(Some(from))
        .with_pruned(Some(excluding))
        .all()?;
    let mut count = 0u32;
    for info in walk {
        let info = info?;
        if info.id == excluding {
            continue;
        }
        count = count.saturating_add(1);
    }
    Ok(count)
}

fn is_ancestor(repo: &gix::Repository, ancestor: gix::ObjectId, descendant: gix::ObjectId) -> bool {
    if ancestor == descendant {
        return true;
    }
    match repo.merge_base(ancestor, descendant) {
        Ok(base) => base.detach() == ancestor,
        Err(_) => false,
    }
}

impl BranchInfo {
    fn kind_sort_key(&self) -> u8 {
        match self.kind {
            BranchKind::Local => 0,
            BranchKind::Remote => 1,
        }
    }
}
