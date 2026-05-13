// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for the issue tracker preferences (issue #306).
//!
//! Three commands round-trip the per-repo override (stored in
//! `.git/config [yryvu] issueTrackerUrl`) and resolve the pattern that
//! the linkifier should apply for a given repo. The global default
//! lives inside the JSON preferences file via
//! [`crate::preferences::IssueTrackerPreferences`] — the resolver here
//! composes everything (override → auto-detect → global default → none).

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::preferences::{self, IssueTrackerPreferences};
use crate::repo::config_custom::{read_custom_value, write_custom_value};
use crate::repo::hosting::{
    classify_url, parse_repo_identifiers, provider_issue_url_pattern, remote_url,
};

const SECTION: &str = "yryvu";
const KEY: &str = "issueTrackerUrl";

#[tauri::command]
pub async fn get_repo_issue_tracker_url(repo_path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_custom_value(&PathBuf::from(repo_path), SECTION, KEY)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_repo_issue_tracker_url(
    repo_path: String,
    value: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_custom_value(&PathBuf::from(repo_path), SECTION, KEY, value.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Compose the effective URL pattern for the given repo. Resolution
/// order:
///
/// 1. Per-repo override from `.git/config [yryvu] issueTrackerUrl` if
///    present.
/// 2. Auto-detect from `origin`'s remote URL when
///    `IssueTrackerPreferences::auto_detect_provider` is `true`.
/// 3. The global default pattern from
///    [`crate::preferences::IssueTrackerPreferences::default_url_pattern`].
/// 4. `None` — no pattern resolved; the linkifier renders refs as
///    plain text.
#[tauri::command]
pub async fn resolve_issue_tracker_pattern(
    app: AppHandle,
    repo_path: String,
) -> Result<Option<String>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(repo_path);
        // (1) per-repo override
        if let Some(override_value) =
            read_custom_value(&path, SECTION, KEY).map_err(|e| e.to_string())?
        {
            return Ok::<Option<String>, String>(Some(override_value));
        }
        let prefs = preferences::load(&dir).map_err(|e| e.to_string())?;
        let it_prefs: &IssueTrackerPreferences = &prefs.issue_tracker;
        // (2) auto-detect via `origin` remote
        if it_prefs.auto_detect_provider {
            if let Some(detected) = auto_detect_pattern(&path) {
                return Ok(Some(detected));
            }
        }
        // (3) global default
        Ok(it_prefs.default_url_pattern.clone())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Inspect `origin`'s URL, classify it, and build the canonical issue
/// URL pattern. Returns `None` when the repo has no origin, the URL
/// is unparseable, or the provider is unknown.
fn auto_detect_pattern(repo_path: &std::path::Path) -> Option<String> {
    let repo = gix::open(repo_path).ok()?;
    let url = remote_url(&repo, "origin")?;
    let (owner, repo_name) = parse_repo_identifiers(&url)?;
    let service = classify_url(&url);
    provider_issue_url_pattern(service, &owner, &repo_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn init_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        git2::Repository::init(dir.path()).unwrap();
        dir
    }

    #[test]
    fn auto_detect_no_remote_returns_none() {
        let dir = init_repo();
        assert_eq!(auto_detect_pattern(dir.path()), None);
    }

    #[test]
    fn auto_detect_github_remote() {
        let dir = init_repo();
        let repo = git2::Repository::open(dir.path()).unwrap();
        repo.remote("origin", "https://github.com/foo/bar.git")
            .unwrap();
        assert_eq!(
            auto_detect_pattern(dir.path()),
            Some("https://github.com/foo/bar/issues/{id}".to_string())
        );
    }

    #[test]
    fn auto_detect_unknown_host_returns_none() {
        let dir = init_repo();
        let repo = git2::Repository::open(dir.path()).unwrap();
        repo.remote("origin", "https://git.example.com/foo/bar.git")
            .unwrap();
        assert_eq!(auto_detect_pattern(dir.path()), None);
    }
}
