// SPDX-License-Identifier: AGPL-3.0-or-later

//! Import access tokens from external CLI tools the user already has
//! authenticated locally. UX win for the technical audience that runs
//! chajá: skip the manual PAT-creation dance entirely when the user
//! already has an authenticated `gh` / `glab` / etc. session.
//!
//! No GK precedent — GUI Git clients traditionally don't integrate
//! with CLI tools. chajá's first-mover affordance.
//!
//! Currently supports: `gh` (GitHub CLI). `glab` and others land in
//! their own follow-up commands.

use std::process::Command;

use crate::backend::BackendError;

/// Read the GitHub access token from the user's existing `gh` CLI
/// session. Shells out to `gh auth token`, optionally with
/// `--hostname <h>` for GitHub Enterprise sessions.
///
/// Errors:
/// - [`BackendError::CliNotFound`] — `gh` binary not on PATH.
/// - [`BackendError::CliNotAuthenticated`] — `gh` is installed but the
///   user hasn't run `gh auth login` (or the session expired).
/// - [`BackendError::CliFailed`] — any other shell-out failure (with
///   stderr captured for diagnosis).
#[tauri::command]
pub async fn import_gh_token(hostname: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("gh");
        cmd.arg("auth").arg("token");
        if let Some(host) = hostname.as_deref() {
            // gh expects bare hostname, not a URL — strip scheme and
            // trailing path so we accept both `https://ghe.example.com`
            // and `ghe.example.com` from the caller.
            let bare = host
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .trim_end_matches('/');
            // Drop any path component after the host.
            let bare = bare.split('/').next().unwrap_or(bare);
            cmd.arg("--hostname").arg(bare);
        }
        // Stdin closed so a misconfigured `gh` can't block waiting for input.
        cmd.stdin(std::process::Stdio::null());

        let output = match cmd.output() {
            Ok(o) => o,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(BackendError::CliNotFound {
                    name: "gh".to_string(),
                }
                .to_string());
            }
            Err(e) => {
                return Err(BackendError::CliFailed {
                    name: "gh".to_string(),
                    stderr: e.to_string(),
                }
                .to_string());
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            // gh's "not authenticated" message variants — match them
            // case-insensitively to typed-error so the UI can surface
            // the right CTA ("run gh auth login").
            let lower = stderr.to_lowercase();
            if lower.contains("no oauth token")
                || lower.contains("not logged in")
                || lower.contains("auth login")
            {
                return Err(BackendError::CliNotAuthenticated {
                    name: "gh".to_string(),
                }
                .to_string());
            }
            return Err(BackendError::CliFailed {
                name: "gh".to_string(),
                stderr,
            }
            .to_string());
        }

        let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if token.is_empty() {
            return Err(BackendError::CliNotAuthenticated {
                name: "gh".to_string(),
            }
            .to_string());
        }
        Ok(token)
    })
    .await
    .map_err(|e| e.to_string())?
}
