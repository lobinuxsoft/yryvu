// SPDX-License-Identifier: AGPL-3.0-or-later

use crate::repo::remote::auth_env::{self, AuthEnv};

/// Probe the host credential environment (SSH agent + git credential
/// helper). The frontend calls this on the first push/delete-remote
/// failure and caches the result until the next failure, then drives the
/// credential setup wizard (#44) from it.
///
/// Runs `ssh-add -l` in a blocking thread to keep the async runtime free.
#[tauri::command]
pub async fn detect_auth_env() -> Result<AuthEnv, String> {
    tauri::async_runtime::spawn_blocking(auth_env::detect)
        .await
        .map_err(|e| e.to_string())
}
