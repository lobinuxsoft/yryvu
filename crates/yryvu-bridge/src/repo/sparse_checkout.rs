// SPDX-License-Identifier: AGPL-3.0-or-later

//! Sparse checkout state read + apply (issue #309).
//!
//! Reading is native (parse `core.sparseCheckout` /
//! `core.sparseCheckoutCone` from `.git/config`, read the patterns
//! file at `.git/info/sparse-checkout`). Applying — init, set,
//! disable, reapply — shells out to the `git` binary because libgit2
//! / gix do not expose sparse-checkout operations and reimplementing
//! the working-tree update against `gix-worktree-state` is a separate
//! research-heavy effort (#309 acceptance criterion 2 is documented
//! as a follow-up).
//!
//! Shell-out is consistent with the existing precedent in
//! `repo::submodules` and `repo::smart_branches`: yryvu already
//! depends on `git` being on `PATH`. Spawning is gated through
//! `tauri::async_runtime::spawn_blocking` at the command layer.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const PATTERNS_FILE: &str = "info/sparse-checkout";

#[derive(Debug, Error)]
pub enum SparseCheckoutError {
    #[error("failed to open repo at {path}: {source}")]
    OpenRepo {
        path: String,
        #[source]
        source: git2::Error,
    },
    #[error("failed to read config at {path}: {source}")]
    ConfigAccess {
        path: String,
        #[source]
        source: git2::Error,
    },
    #[error("filesystem I/O at {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("`git {args}` failed: {stderr}")]
    GitCli { args: String, stderr: String },
    #[error("could not spawn `git`: {0}")]
    Spawn(String),
}

/// Current sparse-checkout state for a repo. `patterns` are the raw
/// lines from `.git/info/sparse-checkout` minus blank / commented
/// rows — order preserved.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SparseCheckoutState {
    pub enabled: bool,
    pub cone_mode: bool,
    pub patterns: Vec<String>,
}

fn read_bool_config(
    config: &git2::Config,
    key: &str,
    repo_path: &Path,
) -> Result<bool, SparseCheckoutError> {
    match config.get_bool(key) {
        Ok(value) => Ok(value),
        Err(err) if err.code() == git2::ErrorCode::NotFound => Ok(false),
        Err(err) => Err(SparseCheckoutError::ConfigAccess {
            path: repo_path.display().to_string(),
            source: err,
        }),
    }
}

fn read_patterns_file(repo: &git2::Repository) -> Result<Vec<String>, SparseCheckoutError> {
    let path = repo.path().join(PATTERNS_FILE);
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => {
            return Err(SparseCheckoutError::Io {
                path: path.display().to_string(),
                source: err,
            })
        }
    };
    Ok(raw
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(String::from)
        .collect())
}

/// Read the current sparse-checkout state. Returns a struct with all
/// false / empty when sparse is not enabled (common case).
pub fn read_state(repo_path: &Path) -> Result<SparseCheckoutState, SparseCheckoutError> {
    let repo = git2::Repository::open(repo_path).map_err(|e| SparseCheckoutError::OpenRepo {
        path: repo_path.display().to_string(),
        source: e,
    })?;
    let config = repo
        .config()
        .map_err(|e| SparseCheckoutError::ConfigAccess {
            path: repo_path.display().to_string(),
            source: e,
        })?;
    let enabled = read_bool_config(&config, "core.sparseCheckout", repo_path)?;
    let cone_mode = read_bool_config(&config, "core.sparseCheckoutCone", repo_path)?;
    let patterns = read_patterns_file(&repo)?;
    Ok(SparseCheckoutState {
        enabled,
        cone_mode,
        patterns,
    })
}

fn workdir(repo_path: &Path) -> Result<std::path::PathBuf, SparseCheckoutError> {
    let repo = git2::Repository::open(repo_path).map_err(|e| SparseCheckoutError::OpenRepo {
        path: repo_path.display().to_string(),
        source: e,
    })?;
    repo.workdir()
        .map(|p| p.to_owned())
        .ok_or_else(|| SparseCheckoutError::Io {
            path: repo_path.display().to_string(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "bare repo has no work tree",
            ),
        })
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<(), SparseCheckoutError> {
    let cwd = workdir(repo_path)?;
    let out = Command::new("git")
        .args(args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| SparseCheckoutError::Spawn(e.to_string()))?;
    if !out.status.success() {
        return Err(SparseCheckoutError::GitCli {
            args: args.join(" "),
            stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }
    Ok(())
}

/// `git sparse-checkout init [--cone]`. Enables sparse-checkout for
/// the repo and seeds the patterns file with a single `/*` line —
/// effectively a no-op until `apply_set` writes real patterns.
pub fn apply_init(repo_path: &Path, cone_mode: bool) -> Result<(), SparseCheckoutError> {
    let mut args: Vec<&str> = vec!["sparse-checkout", "init"];
    if cone_mode {
        args.push("--cone");
    }
    run_git(repo_path, &args)
}

/// `git sparse-checkout set [--cone] <patterns...>`. Overwrites the
/// patterns file and updates the working tree to match.
pub fn apply_set(
    repo_path: &Path,
    cone_mode: bool,
    patterns: &[String],
) -> Result<(), SparseCheckoutError> {
    let mut args: Vec<&str> = vec!["sparse-checkout", "set"];
    if cone_mode {
        args.push("--cone");
    }
    for p in patterns {
        args.push(p);
    }
    run_git(repo_path, &args)
}

/// `git sparse-checkout disable`. Restores every file in the working
/// tree and turns `core.sparseCheckout` off.
pub fn apply_disable(repo_path: &Path) -> Result<(), SparseCheckoutError> {
    run_git(repo_path, &["sparse-checkout", "disable"])
}

/// `git sparse-checkout reapply`. Re-runs the current patterns against
/// the working tree — useful after pull / fetch lands new files that
/// should be hidden by existing sparse rules.
pub fn apply_reapply(repo_path: &Path) -> Result<(), SparseCheckoutError> {
    run_git(repo_path, &["sparse-checkout", "reapply"])
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
    fn read_state_returns_defaults_when_sparse_off() {
        let dir = init_repo();
        let state = read_state(dir.path()).unwrap();
        assert!(!state.enabled);
        assert!(!state.cone_mode);
        assert!(state.patterns.is_empty());
    }

    #[test]
    fn read_state_picks_up_manual_config_flags() {
        // A user may have flipped the config bits without yryvu — we
        // surface whatever Git sees.
        let dir = init_repo();
        let repo = git2::Repository::open(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_bool("core.sparseCheckout", true).unwrap();
        config.set_bool("core.sparseCheckoutCone", true).unwrap();
        drop(config);

        let state = read_state(dir.path()).unwrap();
        assert!(state.enabled);
        assert!(state.cone_mode);
        assert!(state.patterns.is_empty());
    }

    #[test]
    fn read_state_reads_patterns_file_filtering_comments_and_blanks() {
        let dir = init_repo();
        let info = dir.path().join(".git").join("info");
        std::fs::create_dir_all(&info).unwrap();
        std::fs::write(
            info.join("sparse-checkout"),
            "# top-level comment\n\nsrc/\n\n# inline\ndocs/\n  \n",
        )
        .unwrap();

        let state = read_state(dir.path()).unwrap();
        assert_eq!(
            state.patterns,
            vec!["src/".to_string(), "docs/".to_string()]
        );
    }

    #[test]
    fn read_state_missing_patterns_file_is_empty_not_error() {
        let dir = init_repo();
        let state = read_state(dir.path()).unwrap();
        assert!(state.patterns.is_empty());
    }
}
