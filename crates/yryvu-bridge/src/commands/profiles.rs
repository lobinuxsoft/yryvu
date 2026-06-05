// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for user profiles. The config dir is resolved on the
//! backend (same rationale as [`super::preferences`]) and every mutation
//! follows load → mutate → save, returning the updated store so the
//! renderer re-hydrates from a single source of truth.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::backend::CommitOptions;
use crate::profiles::{self, Profile, ProfilesError, ProfilesStore};

pub(crate) fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Stamp the active profile's identity onto `options` for `repo_path`.
/// Best-effort: any failure (no profiles, I/O error, blank identity)
/// leaves `options` untouched so the commit path falls back to git
/// config. Runs inside the caller's blocking task — it opens the repo to
/// classify the remote.
pub(crate) fn stamp_profile_identity(
    config_dir: &Path,
    repo_path: &Path,
    options: &mut CommitOptions,
) {
    let Ok(store) = profiles::load(config_dir) else {
        return;
    };
    if let Some((name, email)) = profiles::resolve(&store, repo_path).and_then(|p| p.identity()) {
        options.author_name = Some(name.to_string());
        options.author_email = Some(email.to_string());
    }
}

/// Load the full store (profiles + overrides + default).
#[tauri::command]
pub async fn list_profiles(app: AppHandle) -> Result<ProfilesStore, String> {
    let dir = config_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || profiles::load(&dir))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Insert or replace a profile (keyed by `id`).
#[tauri::command]
pub async fn save_profile(app: AppHandle, profile: Profile) -> Result<ProfilesStore, String> {
    mutate(&app, move |store| profiles::upsert(store, profile)).await
}

/// Delete a profile and scrub every reference to it.
#[tauri::command]
pub async fn delete_profile(app: AppHandle, id: String) -> Result<ProfilesStore, String> {
    mutate(&app, move |store| profiles::delete(store, &id)).await
}

/// Set (or clear, with `None`) the fallback profile.
#[tauri::command]
pub async fn set_default_profile(
    app: AppHandle,
    id: Option<String>,
) -> Result<ProfilesStore, String> {
    mutate(&app, move |store| store.default_profile_id = id).await
}

/// Pin (or clear, with `None`) a profile to a specific repo path.
#[tauri::command]
pub async fn set_repo_profile_override(
    app: AppHandle,
    repo_path: String,
    profile_id: Option<String>,
) -> Result<ProfilesStore, String> {
    mutate(&app, move |store| {
        profiles::set_repo_override(store, &PathBuf::from(repo_path), profile_id)
    })
    .await
}

/// Resolve the active profile for `repo_path` (override → remote → local).
#[tauri::command]
pub async fn resolve_active_profile(
    app: AppHandle,
    repo_path: String,
) -> Result<Option<Profile>, String> {
    let dir = config_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = profiles::load(&dir)?;
        Ok::<Option<Profile>, ProfilesError>(
            profiles::resolve(&store, &PathBuf::from(repo_path)).cloned(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Shared load → mutate → save → return-store helper.
async fn mutate(
    app: &AppHandle,
    f: impl FnOnce(&mut ProfilesStore) + Send + 'static,
) -> Result<ProfilesStore, String> {
    let dir = config_dir(app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = profiles::load(&dir)?;
        f(&mut store);
        profiles::save(&dir, &store)?;
        Ok::<ProfilesStore, ProfilesError>(store)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
