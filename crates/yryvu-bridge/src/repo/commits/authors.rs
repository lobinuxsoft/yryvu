// SPDX-License-Identifier: AGPL-3.0-or-later

//! Unique recent commit authors for the co-author picker in the commit
//! panel. Walks the last N reachable commits from HEAD, deduplicates by
//! email, and orders by frequency (most-frequent first, then by name
//! alphabetically) so the picker surfaces the people the user actually
//! collaborates with — mirrors GitKraken's `Add Co-Authors` surface.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use crate::backend::BackendError;

use super::super::common::{git2_err, open_git2};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorInfo {
    pub name: String,
    pub email: String,
    /// How many of the scanned commits this author signed. Drives the
    /// ordering and lets the UI surface "frequent" vs "occasional"
    /// collaborators with a hint.
    pub count: u32,
}

/// Default scan window — 200 commits balances coverage on long-lived
/// repos against the cost of walking history every time the panel
/// mounts. Caller can override via the IPC `limit` param.
pub const DEFAULT_LIMIT: usize = 200;

pub fn recent_authors(repo_path: &Path, limit: usize) -> Result<Vec<AuthorInfo>, BackendError> {
    let repo = open_git2(repo_path)?;
    let limit = limit.max(1);

    // Empty repo (unborn HEAD) has no authors yet — quietly return
    // empty so the picker can render its empty state instead of an
    // error toast.
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(Vec::new()),
    };
    let head_oid = match head.target() {
        Some(oid) => oid,
        None => return Ok(Vec::new()),
    };

    // Default sort (parent-after-child) is enough — we want commits in
    // HEAD-first order regardless of timestamp drift. `Sort::TIME` would
    // shuffle ties in commits made within the same second, which makes
    // the `limit` parameter non-deterministic in tests.
    let mut revwalk = repo.revwalk().map_err(git2_err)?;
    revwalk.push(head_oid).map_err(git2_err)?;

    // `(name, count)` keyed by lowercase email so casing variants
    // collapse to the same author (Git treats email case-sensitively
    // but humans don't).
    let mut by_email: HashMap<String, (String, String, u32)> = HashMap::new();
    for (idx, oid) in revwalk.enumerate() {
        if idx >= limit {
            break;
        }
        let oid = oid.map_err(git2_err)?;
        let commit = repo.find_commit(oid).map_err(git2_err)?;
        let author = commit.author();
        let name = author.name().unwrap_or("").trim().to_string();
        let email_raw = author.email().unwrap_or("").trim().to_string();
        if email_raw.is_empty() || name.is_empty() {
            continue;
        }
        let key = email_raw.to_lowercase();
        let entry = by_email
            .entry(key)
            .or_insert((name.clone(), email_raw.clone(), 0));
        entry.2 += 1;
    }

    let mut authors: Vec<AuthorInfo> = by_email
        .into_values()
        .map(|(name, email, count)| AuthorInfo { name, email, count })
        .collect();
    authors.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    Ok(authors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn init_repo() -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        let repo = git2::Repository::init(&path).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Setup").unwrap();
        cfg.set_str("user.email", "setup@example.com").unwrap();
        (dir, path)
    }

    fn commit_as(repo_path: &Path, name: &str, email: &str, file: &str, content: &str) {
        let repo = git2::Repository::open(repo_path).unwrap();
        fs::write(repo_path.join(file), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now(name, email).unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.as_ref().map(|p| vec![p]).unwrap_or_default();
        repo.commit(Some("HEAD"), &sig, &sig, "msg", &tree, &parents)
            .unwrap();
    }

    #[test]
    fn empty_repo_returns_empty_list() {
        let (_dir, path) = init_repo();
        let authors = recent_authors(&path, 50).unwrap();
        assert!(authors.is_empty());
    }

    #[test]
    fn dedupes_by_lowercased_email_and_orders_by_count() {
        let (_dir, path) = init_repo();
        commit_as(&path, "Alice", "alice@example.com", "a.txt", "1");
        commit_as(&path, "Bob", "bob@example.com", "b.txt", "2");
        commit_as(&path, "Alice", "ALICE@example.com", "c.txt", "3");
        commit_as(&path, "Alice", "alice@example.com", "d.txt", "4");

        let authors = recent_authors(&path, 50).unwrap();
        assert_eq!(authors.len(), 2, "{authors:#?}");
        assert_eq!(authors[0].email.to_lowercase(), "alice@example.com");
        assert_eq!(authors[0].count, 3, "Alice should aggregate across casing");
        assert_eq!(authors[1].email, "bob@example.com");
        assert_eq!(authors[1].count, 1);
    }

    #[test]
    fn limit_caps_the_walk_window() {
        let (_dir, path) = init_repo();
        for i in 0..5 {
            commit_as(&path, "Old", "old@example.com", &format!("o{i}.txt"), "x");
        }
        for i in 0..2 {
            commit_as(&path, "New", "new@example.com", &format!("n{i}.txt"), "x");
        }
        // Walk only the 2 newest commits → only "New" should be visible.
        let authors = recent_authors(&path, 2).unwrap();
        assert_eq!(authors.len(), 1);
        assert_eq!(authors[0].email, "new@example.com");
    }
}
