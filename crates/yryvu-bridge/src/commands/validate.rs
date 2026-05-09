// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri command for validating that a directory picked by the user
//! is actually a Git repository before chajá adds it to recents and
//! switches the active tab to it. Catches the "I clicked the wrong
//! folder" case with a typed signal instead of leaking a libgit2
//! error message later.

use std::path::Path;

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepoStatus {
    Valid,
    NotARepo,
    InaccessiblePath,
}

fn check(path: &Path) -> RepoStatus {
    let Ok(meta) = std::fs::metadata(path) else {
        return RepoStatus::InaccessiblePath;
    };
    if !meta.is_dir() {
        return RepoStatus::InaccessiblePath;
    }
    match gix::open(path) {
        Ok(_) => RepoStatus::Valid,
        Err(_) => RepoStatus::NotARepo,
    }
}

#[tauri::command]
pub async fn validate_git_repo(path: String) -> Result<RepoStatus, String> {
    tauri::async_runtime::spawn_blocking(move || check(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_non_bare_returns_valid() {
        let tmp = tempfile::tempdir().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        assert!(matches!(check(tmp.path()), RepoStatus::Valid));
    }

    #[test]
    fn valid_bare_returns_valid() {
        let tmp = tempfile::tempdir().unwrap();
        git2::Repository::init_bare(tmp.path()).unwrap();
        assert!(matches!(check(tmp.path()), RepoStatus::Valid));
    }

    #[test]
    fn plain_directory_returns_not_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("hello.txt"), "hi").unwrap();
        assert!(matches!(check(tmp.path()), RepoStatus::NotARepo));
    }

    #[test]
    fn missing_path_returns_inaccessible() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("does-not-exist");
        assert!(matches!(check(&missing), RepoStatus::InaccessiblePath));
    }

    #[test]
    fn file_returns_inaccessible() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("just-a-file.txt");
        std::fs::write(&f, "x").unwrap();
        assert!(matches!(check(&f), RepoStatus::InaccessiblePath));
    }
}
