// SPDX-License-Identifier: AGPL-3.0-or-later

//! "Keep submodules up to date" (#98, GK parity): per-repo tri-state
//! stored in `.git/config [yryvu] submoduleAutoUpdate`, resolved
//! against the global preference, and the post-op `update --init
//! --recursive` runner fired after checkout / merge / pull.

use std::path::Path;

use anyhow::anyhow;

use crate::backend::BackendError;

use super::{open_git2, run_git};

/// Per-repo override for "Keep submodules up to date" (#98). Stored
/// in the repo's local `.git/config` under `[yryvu]
/// submoduleAutoUpdate` (issue-tracker pattern). Values mirror GK's
/// tri-state: `"enabled"` / `"disabled"`; an absent key means "use
/// the global setting" and reads back as `"default"`.
const AUTO_UPDATE_KEY: &str = "submoduleAutoUpdate";

pub fn auto_update_setting(repo_path: &Path) -> Result<String, BackendError> {
    let value = crate::repo::config_custom::read_custom_value(repo_path, "yryvu", AUTO_UPDATE_KEY)
        .map_err(|e| BackendError::Git(anyhow!("read submodule auto-update setting: {e}")))?;
    Ok(match value.as_deref() {
        Some("enabled") => "enabled".to_string(),
        Some("disabled") => "disabled".to_string(),
        _ => "default".to_string(),
    })
}

pub fn set_auto_update_setting(repo_path: &Path, value: &str) -> Result<(), BackendError> {
    let stored = match value {
        "enabled" => Some("enabled"),
        "disabled" => Some("disabled"),
        // "default" = fall through to the global setting — remove the
        // key instead of storing a third literal.
        "default" => None,
        other => {
            return Err(BackendError::Git(anyhow!(
                "invalid submodule auto-update value '{other}'"
            )))
        }
    };
    crate::repo::config_custom::write_custom_value(repo_path, "yryvu", AUTO_UPDATE_KEY, stored)
        .map_err(|e| BackendError::Git(anyhow!("write submodule auto-update setting: {e}")))
}

/// Resolve GK's tri-state: per-repo override wins, `"default"` falls
/// through to the global preference. Pure — unit-tested directly.
pub fn resolve_auto_update(repo_setting: &str, global_default: bool) -> bool {
    match repo_setting {
        "enabled" => true,
        "disabled" => false,
        _ => global_default,
    }
}

/// Run `git submodule update --init --recursive` for the whole repo —
/// what GK fires after checkout / merge / pull when "Keep submodules
/// up to date" resolves enabled. Returns `false` without spawning git
/// when the repo declares no submodules (`.gitmodules` absent): the
/// common case must stay free.
pub fn auto_update_all(repo_path: &Path) -> Result<bool, BackendError> {
    let repo = open_git2(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| BackendError::Git(anyhow!("repo is bare, cannot update submodules")))?
        .to_owned();
    drop(repo);
    if !workdir.join(".gitmodules").exists() {
        return Ok(false);
    }
    run_git(&workdir, &["submodule", "update", "--init", "--recursive"])?;
    Ok(true)
}
