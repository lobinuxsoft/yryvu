// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use serde::Serialize;

use crate::repo::deep_link::{self, LinkTarget, RepoLink};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLink {
    pub link: RepoLink,
    pub matches: Vec<String>,
}

#[tauri::command]
pub async fn build_repo_link(repo_path: String, target: LinkTarget) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        deep_link::build_link(&PathBuf::from(repo_path), target).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Parse `url` and list which of `candidates` hold that repo.
#[tauri::command]
pub async fn resolve_repo_link(
    url: String,
    candidates: Vec<String>,
) -> Result<ResolvedLink, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let link = deep_link::parse_link(&url)?;
        let paths: Vec<PathBuf> = candidates.into_iter().map(PathBuf::from).collect();
        let matches = deep_link::resolve_link(&paths, &link)
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        Ok(ResolvedLink { link, matches })
    })
    .await
    .map_err(|e| e.to_string())?
}
