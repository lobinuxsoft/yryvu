// SPDX-License-Identifier: AGPL-3.0-or-later

//! Sign config inspection — `gpg.format`, `user.signingkey`, `gpg.program`,
//! `gpg.ssh.program`, plus the committer identity (`user.name`,
//! `user.email`). Used by the commit panel preflight and by the key
//! generator to pre-fill its dialog.

use crate::backend::BackendError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignFormat {
    OpenPgp,
    Ssh,
}

/// Result of inspecting a repo's signing config. `None` for `key` means
/// `user.signingkey` is not set and signing cannot proceed. The struct
/// crosses the IPC boundary so the commit panel can disable the Sign
/// toggle (and surface a helpful hint) when no key is wired up.
/// `userName` / `userEmail` come from `user.name` / `user.email` in the
/// same config — the in-app key generator pre-fills its dialog from
/// them so the new GPG key matches the committer identity Git already
/// uses.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignConfig {
    pub format: SignFormat,
    pub key: Option<String>,
    pub program: String,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

pub fn load_config(repo: &git2::Repository) -> SignConfig {
    let cfg = repo.config().ok();
    let format = match cfg
        .as_ref()
        .and_then(|c| c.get_string("gpg.format").ok())
        .as_deref()
    {
        Some("ssh") => SignFormat::Ssh,
        Some("x509") => SignFormat::OpenPgp, // X.509 via gpgsm; we ignore the distinction
        _ => SignFormat::OpenPgp,
    };
    let key = cfg
        .as_ref()
        .and_then(|c| c.get_string("user.signingkey").ok())
        .filter(|s| !s.trim().is_empty());
    let program = cfg
        .as_ref()
        .and_then(|c| match format {
            SignFormat::OpenPgp => c.get_string("gpg.program").ok(),
            SignFormat::Ssh => c.get_string("gpg.ssh.program").ok(),
        })
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default_program(format).to_string());
    let user_name = cfg
        .as_ref()
        .and_then(|c| c.get_string("user.name").ok())
        .filter(|s| !s.trim().is_empty());
    let user_email = cfg
        .as_ref()
        .and_then(|c| c.get_string("user.email").ok())
        .filter(|s| !s.trim().is_empty());
    SignConfig {
        format,
        key,
        program,
        user_name,
        user_email,
    }
}

fn default_program(format: SignFormat) -> &'static str {
    match format {
        SignFormat::OpenPgp => "gpg",
        SignFormat::Ssh => "ssh-keygen",
    }
}

/// Inspect signing config from disk for a given path. Used by the
/// commit panel preflight (`commit_sign_config` IPC command).
pub fn inspect_config(repo_path: &std::path::Path) -> Result<SignConfig, BackendError> {
    let repo = crate::repo::common::open_git2(repo_path)?;
    Ok(load_config(&repo))
}
