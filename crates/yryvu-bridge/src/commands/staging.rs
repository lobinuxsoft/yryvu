// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use tauri::AppHandle;

use crate::backend::{
    CommitOptions, FileDiff, GenerateKeyRequest, GeneratedKey, GitBackend, GpgKeyInfo, LineRange,
    SignConfig, SignFormat, WorkingTreeStatus,
};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn working_tree_status(repo_path: String) -> Result<WorkingTreeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .working_tree_status(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stage_files(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stage_files(&PathBuf::from(&repo_path), &paths)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unstage_files(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .unstage_files(&PathBuf::from(&repo_path), &paths)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stage only a file-mode change (issue #60) — distinct action path from
/// content staging so the UI surfaces the mode-specific affordance/error.
#[tauri::command]
pub async fn stage_filemode(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::repo::staging::stage_filemode(&PathBuf::from(&repo_path), &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unstage_filemode(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::repo::staging::unstage_filemode(&PathBuf::from(&repo_path), &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn diff_unstaged(repo_path: String, path: String) -> Result<FileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .diff_unstaged(&PathBuf::from(&repo_path), &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn diff_staged(repo_path: String, path: String) -> Result<FileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .diff_staged(&PathBuf::from(&repo_path), &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn commit_staged(repo_path: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .commit_staged(&PathBuf::from(&repo_path), &message)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn amend_commit(repo_path: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .amend_commit(&PathBuf::from(&repo_path), &message)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn head_commit_message(repo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .head_commit_message(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stage_all(repo_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stage_all(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unstage_all(repo_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .unstage_all(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn discard_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .discard_paths(&PathBuf::from(&repo_path), &paths)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Discard every local change — staged and unstaged — via `git reset --hard
/// HEAD` + removal of untracked files. More reliable than per-path
/// `discard_paths` for binary, LFS, and filter-driven files because it
/// delegates to git's own reset machinery instead of per-path checkout.
#[tauri::command]
pub async fn discard_all(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::repo::staging::discard_all(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_commit(
    app: AppHandle,
    repo_path: String,
    options: CommitOptions,
) -> Result<String, String> {
    let config_dir = super::profiles::config_dir(&app).ok();
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let mut options = options;
        if let Some(dir) = &config_dir {
            super::profiles::stamp_profile_identity(dir, &path, &mut options);
        }
        GixBackend
            .create_commit(&path, &options)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn commit_and_push(
    app: AppHandle,
    repo_path: String,
    options: CommitOptions,
) -> Result<String, String> {
    let config_dir = super::profiles::config_dir(&app).ok();
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let mut options = options;
        if let Some(dir) = &config_dir {
            super::profiles::stamp_profile_identity(dir, &path, &mut options);
        }
        GixBackend
            .commit_and_push(&path, &options)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stage_hunks(
    repo_path: String,
    path: String,
    hunk_indices: Vec<usize>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stage_hunks(&PathBuf::from(&repo_path), &path, &hunk_indices)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unstage_hunks(
    repo_path: String,
    path: String,
    hunk_indices: Vec<usize>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .unstage_hunks(&PathBuf::from(&repo_path), &path, &hunk_indices)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn discard_hunks(
    repo_path: String,
    path: String,
    hunk_indices: Vec<usize>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .discard_hunks(&PathBuf::from(&repo_path), &path, &hunk_indices)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stage_lines(
    repo_path: String,
    path: String,
    ranges: Vec<LineRange>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stage_lines(&PathBuf::from(&repo_path), &path, &ranges)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unstage_lines(
    repo_path: String,
    path: String,
    ranges: Vec<LineRange>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .unstage_lines(&PathBuf::from(&repo_path), &path, &ranges)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn discard_lines(
    repo_path: String,
    path: String,
    ranges: Vec<LineRange>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .discard_lines(&PathBuf::from(&repo_path), &path, &ranges)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn commit_sign_config(repo_path: String) -> Result<SignConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .commit_sign_config(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn generate_gpg_key(req: GenerateKeyRequest) -> Result<GeneratedKey, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend.generate_gpg_key(&req).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_gpg_public_key(selector: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .export_gpg_public_key(&selector)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_gpg_keys() -> Result<Vec<GpgKeyInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| GixBackend.list_gpg_keys().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_signing_key(
    repo_path: String,
    key: String,
    format: SignFormat,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .set_signing_key(&PathBuf::from(&repo_path), &key, format)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
