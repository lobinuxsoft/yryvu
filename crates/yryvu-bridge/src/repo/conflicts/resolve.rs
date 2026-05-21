// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::anyhow;
use git2::{IndexEntry, IndexTime, Repository};

use crate::backend::BackendError;

use super::super::common::{git2_err, open_git2};
use super::{ConflictDiff3, ConflictSide, ConflictSource};

/// Read the three stages plus the worktree content of a conflicted
/// file. Missing stages stay `None` (delete/modify or add/add cases).
pub fn read_diff3(repo_path: &Path, path: &str) -> Result<ConflictDiff3, BackendError> {
    let repo = open_git2(repo_path)?;
    let idx = repo.index().map_err(git2_err)?;
    let base = stage_blob(&repo, &idx, path, 1)?;
    let ours = stage_blob(&repo, &idx, path, 2)?;
    let theirs = stage_blob(&repo, &idx, path, 3)?;
    let working = std::fs::read_to_string(repo_path.join(path)).unwrap_or_default();
    Ok(ConflictDiff3 {
        base,
        ours,
        theirs,
        working,
    })
}

fn stage_blob(
    repo: &Repository,
    idx: &git2::Index,
    path: &str,
    stage: i32,
) -> Result<Option<String>, BackendError> {
    let Some(entry) = idx.get_path(Path::new(path), stage) else {
        return Ok(None);
    };
    let blob = repo.find_blob(entry.id).map_err(git2_err)?;
    Ok(Some(String::from_utf8_lossy(blob.content()).into_owned()))
}

/// Replace stages 1/2/3 with a single stage-0 entry whose content
/// matches one of the original sides. The worktree file is overwritten
/// to match the chosen side as well (so `git status` is consistent).
pub fn accept_side(repo_path: &Path, path: &str, side: ConflictSide) -> Result<(), BackendError> {
    let diff3 = read_diff3(repo_path, path)?;
    let content = match side {
        ConflictSide::Ours => diff3.ours,
        ConflictSide::Theirs => diff3.theirs,
        ConflictSide::Base => diff3.base,
    }
    .ok_or_else(|| BackendError::Git(anyhow!("requested side has no blob at stage")))?;
    resolve_with_content(repo_path, path, &content)
}

/// Write `content` to the worktree + index at stage 0, removing
/// stages 1/2/3 (this is how libgit2 marks the path as resolved).
pub fn resolve_with_content(
    repo_path: &Path,
    path: &str,
    content: &str,
) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let absolute = repo_path.join(path);
    if let Some(parent) = absolute.parent() {
        std::fs::create_dir_all(parent).map_err(|e| BackendError::Git(anyhow!(e)))?;
    }
    std::fs::write(&absolute, content).map_err(|e| BackendError::Git(anyhow!(e)))?;
    add_resolved_blob(&repo, path, content.as_bytes())
}

/// Resolve from the current worktree content. Refuses if conflict
/// markers (`<<<<<<<`, `=======`, `>>>>>>>`) remain in the file.
pub fn mark_resolved(repo_path: &Path, path: &str) -> Result<(), BackendError> {
    let absolute = repo_path.join(path);
    let content = std::fs::read_to_string(&absolute).map_err(|e| BackendError::Git(anyhow!(e)))?;
    if detect_conflict_markers(&content) {
        return Err(BackendError::Git(anyhow!(
            "conflict markers still present in {path}; resolve them before marking as resolved"
        )));
    }
    let repo = open_git2(repo_path)?;
    add_resolved_blob(&repo, path, content.as_bytes())
}

/// `true` when the content still has any of the standard conflict
/// marker lines that libgit2 / git CLI write. Used as the guard
/// before mark-as-resolved (acceptance: "Detects leftover markers
/// before allowing commit").
pub fn detect_conflict_markers(content: &str) -> bool {
    content.lines().any(|line| {
        line.starts_with("<<<<<<<")
            || line.starts_with("=======")
            || line.starts_with(">>>>>>>")
            || line.starts_with("|||||||")
    })
}

fn add_resolved_blob(repo: &Repository, path: &str, content: &[u8]) -> Result<(), BackendError> {
    let oid = repo.blob(content).map_err(git2_err)?;
    let mut idx = repo.index().map_err(git2_err)?;
    let path_bytes = path.as_bytes().to_vec();
    let _ = idx.remove_path(Path::new(path));
    let entry = IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode: 0o100644,
        uid: 0,
        gid: 0,
        file_size: content.len() as u32,
        id: oid,
        flags: 0,
        flags_extended: 0,
        path: path_bytes,
    };
    idx.add(&entry).map_err(git2_err)?;
    idx.write().map_err(git2_err)?;
    Ok(())
}

/// Wrap up the in-progress op (merge / cherry-pick / revert / native
/// rebase) once every path has been resolved. For yryvu's interactive
/// rebase this is a no-op — the caller should invoke
/// `repo::rebase::interactive::continue_rebase` instead so the
/// orchestrator advances the plan.
pub fn finish_in_progress(repo_path: &Path) -> Result<ConflictSource, BackendError> {
    let listing = super::list_conflicts(repo_path)?;
    if !listing.files.is_empty() {
        return Err(BackendError::Git(anyhow!(
            "{} path(s) still unresolved",
            listing.files.len()
        )));
    }
    let source = listing.source;
    if source == ConflictSource::InteractiveRebase {
        // The interactive-rebase orchestrator owns its lifecycle —
        // it is the caller's job to advance / finish the plan.
        return Ok(source);
    }
    let repo = open_git2(repo_path)?;
    let mut idx = repo.index().map_err(git2_err)?;
    let tree_oid = idx.write_tree().map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;
    match source {
        ConflictSource::Merge => {
            commit_merge(&repo, &tree)?;
        }
        ConflictSource::CherryPick | ConflictSource::Revert => {
            commit_single_parent(&repo, &tree, source)?;
        }
        ConflictSource::Rebase | ConflictSource::Bisect | ConflictSource::Standalone => {
            // The git CLI rebase / bisect flows need shell-out to
            // resume — yryvu does not own them. Caller decides.
        }
        ConflictSource::InteractiveRebase => unreachable!(),
    }
    repo.cleanup_state().map_err(git2_err)?;
    Ok(source)
}

fn commit_merge(repo: &Repository, tree: &git2::Tree<'_>) -> Result<(), BackendError> {
    let head = repo
        .head()
        .map_err(git2_err)?
        .peel_to_commit()
        .map_err(git2_err)?;
    let merge_head_path = repo.path().join("MERGE_HEAD");
    let merge_head_oid = std::fs::read_to_string(&merge_head_path)
        .map_err(|e| BackendError::Git(anyhow!(e)))?
        .trim()
        .to_string();
    let other_oid = git2::Oid::from_str(&merge_head_oid).map_err(git2_err)?;
    let other = repo.find_commit(other_oid).map_err(git2_err)?;
    let signature = repo.signature().map_err(git2_err)?;
    let msg = std::fs::read_to_string(repo.path().join("MERGE_MSG"))
        .unwrap_or_else(|_| format!("Merge commit {}", other_oid));
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        msg.trim(),
        tree,
        &[&head, &other],
    )
    .map_err(git2_err)?;
    Ok(())
}

fn commit_single_parent(
    repo: &Repository,
    tree: &git2::Tree<'_>,
    source: ConflictSource,
) -> Result<(), BackendError> {
    let head = repo
        .head()
        .map_err(git2_err)?
        .peel_to_commit()
        .map_err(git2_err)?;
    let signature = repo.signature().map_err(git2_err)?;
    let msg_filename = if source == ConflictSource::CherryPick {
        "CHERRY_PICK_HEAD"
    } else {
        "REVERT_HEAD"
    };
    let source_oid = std::fs::read_to_string(repo.path().join(msg_filename))
        .ok()
        .and_then(|s| git2::Oid::from_str(s.trim()).ok());
    let default_msg = match source {
        ConflictSource::CherryPick => "cherry-pick: resolved",
        _ => "revert: resolved",
    };
    let msg = source_oid
        .and_then(|oid| repo.find_commit(oid).ok())
        .and_then(|c| c.message().map(|m| m.to_string()))
        .unwrap_or_else(|| default_msg.to_string());
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        msg.trim(),
        tree,
        &[&head],
    )
    .map_err(git2_err)?;
    Ok(())
}
