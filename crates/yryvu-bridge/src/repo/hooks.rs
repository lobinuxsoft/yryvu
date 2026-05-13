// SPDX-License-Identifier: AGPL-3.0-or-later

//! Git hooks listing + enable/disable (issue #192).
//!
//! Resolves the hooks directory in the same order Git itself does:
//!
//! 1. `core.hooksPath` (local config) — overrides the default; users
//!    who keep hooks under a shared dir (`~/dotfiles/hooks`, husky's
//!    `.husky/_`, etc.) point here.
//! 2. `<repo>/.git/hooks` — the default. For bare repos, the bare
//!    repo dir IS the git dir.
//!
//! "Enabled" / "disabled" is a yryvu convention: an executable file
//! named exactly `pre-commit` is enabled; `pre-commit.disabled` is
//! disabled. Git itself only cares about the filename matching its
//! canonical set, so renaming with the `.disabled` suffix takes the
//! hook out of Git's path without losing the script. Files ending in
//! `.sample` (Git's default templates) are filtered out — they're not
//! actionable hooks until the user makes a copy.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const DISABLED_SUFFIX: &str = ".disabled";
const SAMPLE_SUFFIX: &str = ".sample";

#[derive(Debug, Error)]
pub enum HooksError {
    #[error("failed to open repo at {path}: {source}")]
    OpenRepo {
        path: String,
        #[source]
        source: git2::Error,
    },
    #[error("hooks directory I/O at {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("hook `{name}` not found in {dir}")]
    NotFound { name: String, dir: String },
}

/// One hook script discovered in the active hooks directory. `path`
/// is the absolute file path (already accounting for the `.disabled`
/// suffix when disabled) so the frontend can pass it back unchanged
/// to `open_hook_script`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HookEntry {
    pub name: String,
    pub enabled: bool,
    pub path: String,
}

/// Resolve the active hooks directory for `repo_path`. Mirrors Git's
/// own logic: `core.hooksPath` wins, else `<git_dir>/hooks`.
pub fn resolve_hooks_dir(repo_path: &Path) -> Result<PathBuf, HooksError> {
    let repo = git2::Repository::open(repo_path).map_err(|e| HooksError::OpenRepo {
        path: repo_path.display().to_string(),
        source: e,
    })?;
    if let Ok(config) = repo.config() {
        if let Ok(custom) = config.get_path("core.hooksPath") {
            return Ok(if custom.is_absolute() {
                custom
            } else {
                // `core.hooksPath` may be relative to the work tree (the
                // standard interpretation) — anchor it there. For bare
                // repos we fall back to the git dir.
                let base = repo.workdir().unwrap_or_else(|| repo.path());
                base.join(custom)
            });
        }
    }
    Ok(repo.path().join("hooks"))
}

/// List every hook script in the active hooks directory. Returns an
/// empty list when the directory doesn't exist (a fresh `git init` may
/// not have populated it yet).
pub fn list_hooks(repo_path: &Path) -> Result<Vec<HookEntry>, HooksError> {
    let dir = resolve_hooks_dir(repo_path)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let read_dir = std::fs::read_dir(&dir).map_err(|e| HooksError::Io {
        path: dir.display().to_string(),
        source: e,
    })?;
    let mut entries: Vec<HookEntry> = Vec::new();
    for raw in read_dir.flatten() {
        let file_type = match raw.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if !file_type.is_file() && !file_type.is_symlink() {
            continue;
        }
        let file_name = raw.file_name();
        let name = match file_name.to_str() {
            Some(n) => n,
            None => continue,
        };
        if name.ends_with(SAMPLE_SUFFIX) {
            continue;
        }
        let (canonical_name, enabled) = if let Some(stripped) = name.strip_suffix(DISABLED_SUFFIX) {
            (stripped.to_string(), false)
        } else {
            (name.to_string(), true)
        };
        entries.push(HookEntry {
            name: canonical_name,
            enabled,
            path: raw.path().to_string_lossy().to_string(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Toggle a hook by renaming the file to/from the `.disabled` suffix.
/// Idempotent — calling `set_hook_enabled(true)` on an already-enabled
/// hook is a no-op.
pub fn set_hook_enabled(repo_path: &Path, name: &str, enabled: bool) -> Result<(), HooksError> {
    let dir = resolve_hooks_dir(repo_path)?;
    let active = dir.join(name);
    let disabled = dir.join(format!("{name}{DISABLED_SUFFIX}"));
    match (enabled, active.exists(), disabled.exists()) {
        // Already in the desired state.
        (true, true, _) | (false, _, true) => Ok(()),
        // Enable: restore from `.disabled`.
        (true, false, true) => std::fs::rename(&disabled, &active).map_err(|e| HooksError::Io {
            path: disabled.display().to_string(),
            source: e,
        }),
        // Disable: rename active to `.disabled`.
        (false, true, false) => std::fs::rename(&active, &disabled).map_err(|e| HooksError::Io {
            path: active.display().to_string(),
            source: e,
        }),
        // Neither file present — caller asked us to toggle a hook that
        // doesn't exist.
        (_, false, false) => Err(HooksError::NotFound {
            name: name.to_string(),
            dir: dir.display().to_string(),
        }),
    }
}

/// Resolve the absolute path for a hook script by canonical `name`,
/// regardless of whether it is currently enabled or disabled. Used by
/// the `open_hook_script` Tauri command to hand a real path to the
/// opener plugin.
pub fn hook_script_path(repo_path: &Path, name: &str) -> Result<PathBuf, HooksError> {
    let dir = resolve_hooks_dir(repo_path)?;
    let active = dir.join(name);
    if active.is_file() {
        return Ok(active);
    }
    let disabled = dir.join(format!("{name}{DISABLED_SUFFIX}"));
    if disabled.is_file() {
        return Ok(disabled);
    }
    Err(HooksError::NotFound {
        name: name.to_string(),
        dir: dir.display().to_string(),
    })
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

    fn write_hook(dir: &Path, name: &str, body: &str) {
        let hooks = dir.join(".git").join("hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        std::fs::write(hooks.join(name), body).unwrap();
    }

    #[test]
    fn list_hooks_empty_when_dir_missing() {
        let dir = init_repo();
        std::fs::remove_dir_all(dir.path().join(".git").join("hooks")).ok();
        let hooks = list_hooks(dir.path()).unwrap();
        assert!(hooks.is_empty());
    }

    #[test]
    fn list_hooks_ignores_sample_files() {
        let dir = init_repo();
        write_hook(dir.path(), "pre-commit.sample", "#!/bin/sh\n");
        let hooks = list_hooks(dir.path()).unwrap();
        assert!(hooks.is_empty(), "sample files must be filtered out");
    }

    #[test]
    fn list_hooks_marks_disabled_files() {
        let dir = init_repo();
        write_hook(dir.path(), "pre-commit", "#!/bin/sh\n");
        write_hook(dir.path(), "commit-msg.disabled", "#!/bin/sh\n");
        let hooks = list_hooks(dir.path()).unwrap();
        let names: Vec<(&str, bool)> = hooks.iter().map(|h| (h.name.as_str(), h.enabled)).collect();
        assert_eq!(names, vec![("commit-msg", false), ("pre-commit", true)]);
    }

    #[test]
    fn set_hook_enabled_disables_active() {
        let dir = init_repo();
        write_hook(dir.path(), "pre-commit", "#!/bin/sh\n");
        set_hook_enabled(dir.path(), "pre-commit", false).unwrap();
        assert!(!dir.path().join(".git/hooks/pre-commit").exists());
        assert!(dir.path().join(".git/hooks/pre-commit.disabled").is_file());
    }

    #[test]
    fn set_hook_enabled_enables_disabled() {
        let dir = init_repo();
        write_hook(dir.path(), "pre-push.disabled", "#!/bin/sh\n");
        set_hook_enabled(dir.path(), "pre-push", true).unwrap();
        assert!(dir.path().join(".git/hooks/pre-push").is_file());
        assert!(!dir.path().join(".git/hooks/pre-push.disabled").exists());
    }

    #[test]
    fn set_hook_enabled_is_idempotent_for_current_state() {
        let dir = init_repo();
        write_hook(dir.path(), "post-merge", "#!/bin/sh\n");
        // Already enabled — calling enable again is a no-op.
        set_hook_enabled(dir.path(), "post-merge", true).unwrap();
        assert!(dir.path().join(".git/hooks/post-merge").is_file());
    }

    #[test]
    fn set_hook_enabled_errors_when_missing() {
        let dir = init_repo();
        let err = set_hook_enabled(dir.path(), "nope", false).unwrap_err();
        assert!(matches!(err, HooksError::NotFound { .. }));
    }

    #[test]
    fn resolve_hooks_dir_respects_core_hookspath() {
        let dir = init_repo();
        let custom = dir.path().join("my-hooks");
        std::fs::create_dir_all(&custom).unwrap();
        let repo = git2::Repository::open(dir.path()).unwrap();
        repo.config()
            .unwrap()
            .set_str("core.hooksPath", custom.to_str().unwrap())
            .unwrap();
        let resolved = resolve_hooks_dir(dir.path()).unwrap();
        assert_eq!(
            std::fs::canonicalize(resolved).unwrap(),
            std::fs::canonicalize(&custom).unwrap()
        );
    }

    #[test]
    fn hook_script_path_finds_active_and_disabled() {
        let dir = init_repo();
        write_hook(dir.path(), "pre-commit", "#!/bin/sh\n");
        write_hook(dir.path(), "commit-msg.disabled", "#!/bin/sh\n");
        let pre = hook_script_path(dir.path(), "pre-commit").unwrap();
        assert!(pre.file_name().unwrap() == "pre-commit");
        let msg = hook_script_path(dir.path(), "commit-msg").unwrap();
        assert!(msg.file_name().unwrap() == "commit-msg.disabled");
    }
}
