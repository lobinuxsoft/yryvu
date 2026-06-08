// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for integration credential persistence + provider API
//! routing (#252). Surface mirrors the frontend's signal-only API
//! (`ipc/integrations/*`) so the swap is a drop-in. Split by domain:
//!
//! - [`storage`] — token + hostname sidecar persistence, preflight.
//! - [`prs`] — list pull / merge requests (per-provider dispatch).
//! - [`issues`] — list + detail.
//! - [`comments`] — list + create on issues / PRs.
//! - [`selectors`] — labels / collaborators / milestones for the forms.
//! - [`clone`] — clone-candidate enumeration.
//! - [`create`] — create PR / issue.
//! - [`oauth`] — the three-phase loopback OAuth flow.
//!
//! Re-exported flat so the `generate_handler!` registration in
//! `src-tauri/src/lib.rs` keeps reaching each command as
//! `yryvu_bridge::commands::<name>`.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::integrations::{self, AuthData};

use super::integration_routing::is_self_hosted;

mod clone;
mod comments;
mod create;
mod issues;
mod oauth;
mod prs;
mod selectors;
mod storage;

pub use clone::*;
pub use comments::*;
pub use create::*;
pub use issues::*;
pub use oauth::*;
pub use prs::*;
pub use selectors::*;
pub use storage::*;

/// Resolve the sidecar JSON path under the app's local data dir. Same
/// shape as the preferences sidecar — kept separate because they have
/// different schemas + lifecycles.
pub(super) fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("integrations.json"))
}

/// Load an integration's auth + resolve the effective hostname for
/// dispatch. Centralises the boilerplate every integration command
/// repeats (sidecar load → not-connected error → self-hosted hostname
/// gate). Returns `(AuthData, Option<&'a str>)` where the hostname is
/// `Some` only for self-hosted variants.
pub(super) async fn load_auth_and_host(
    app: &AppHandle,
    profile_id: Option<&str>,
    integration_type: &str,
) -> Result<AuthData, String> {
    let path = sidecar_path(app)?;
    let it = integration_type.to_string();
    let pid = profile_id.map(str::to_string);
    tauri::async_runtime::spawn_blocking(move || {
        integrations::get_integration(&path as &Path, pid.as_deref(), &it)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))
}

pub(super) fn host_for<'a>(integration_type: &str, auth: &'a AuthData) -> Option<&'a str> {
    is_self_hosted(integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten()
}
