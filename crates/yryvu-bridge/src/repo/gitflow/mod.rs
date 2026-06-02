// SPDX-License-Identifier: AGPL-3.0-or-later

//! Git Flow configuration (issue #305).
//!
//! Storage is per-repo, not user-wide — the canonical home is the
//! repo's own `.git/config` under the `[gitflow]` section. Reads return
//! `None` when the section is absent (repo not initialized for
//! gitflow); writes drop the entire section so initialise / re-init is
//! deterministic. The defaults follow Vincent Driessen's original
//! model + the modern-team override (`main` instead of `master`).
//!
//! Out of scope for this module:
//!
//! - gitflow-avh extensions.
//! - `gitflow.path.*` keys some tooling writes; we keep the surface
//!   small.
//!
//! The branch *operations* (feature / release / hotfix start + finish,
//! plus GitHub Flow) live in [`ops`] — they consume the config this
//! module reads.

pub mod ops;

use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const SECTION: &str = "gitflow";
const KEY_BRANCH_MASTER: &str = "branch.master";
const KEY_BRANCH_DEVELOP: &str = "branch.develop";
const KEY_PREFIX_FEATURE: &str = "prefix.feature";
const KEY_PREFIX_RELEASE: &str = "prefix.release";
const KEY_PREFIX_HOTFIX: &str = "prefix.hotfix";
const KEY_PREFIX_BUGFIX: &str = "prefix.bugfix";
const KEY_PREFIX_SUPPORT: &str = "prefix.support";
const KEY_PREFIX_VERSION_TAG: &str = "prefix.versiontag";

#[derive(Debug, Error)]
pub enum GitflowError {
    #[error("failed to open repo at {path}: {source}")]
    OpenRepo {
        path: String,
        #[source]
        source: git2::Error,
    },
    #[error("failed to access config at {path}: {source}")]
    ConfigAccess {
        path: String,
        #[source]
        source: git2::Error,
    },
    #[error("failed to mutate config at {path}: {source}")]
    ConfigMutate {
        path: String,
        #[source]
        source: git2::Error,
    },
    #[error("gitflow is not initialised for this repository")]
    NotInitialised,
    #[error(transparent)]
    Backend(#[from] crate::backend::BackendError),
}

/// Per-repo gitflow configuration. Mirrors the keys
/// `git-flow init` writes under `[gitflow]` in `.git/config`.
/// `version_tag_prefix` may legitimately be empty (a repo can tag
/// releases as bare `1.2.3`); the empty string serializes as such.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitflowConfig {
    pub master_branch: String,
    pub develop_branch: String,
    pub feature_prefix: String,
    pub release_prefix: String,
    pub hotfix_prefix: String,
    pub bugfix_prefix: String,
    pub support_prefix: String,
    pub version_tag_prefix: String,
}

impl GitflowConfig {
    /// Defaults that match `git-flow init` answers post-2020 — `main`
    /// instead of `master` (industry shift), Driessen's canonical
    /// prefixes for everything else, `v` for tags.
    pub fn defaults() -> Self {
        Self {
            master_branch: "main".to_string(),
            develop_branch: "develop".to_string(),
            feature_prefix: "feature/".to_string(),
            release_prefix: "release/".to_string(),
            hotfix_prefix: "hotfix/".to_string(),
            bugfix_prefix: "bugfix/".to_string(),
            support_prefix: "support/".to_string(),
            version_tag_prefix: "v".to_string(),
        }
    }
}

fn open_repo_config(repo_path: &Path) -> Result<(git2::Repository, git2::Config), GitflowError> {
    let repo = git2::Repository::open(repo_path).map_err(|e| GitflowError::OpenRepo {
        path: repo_path.display().to_string(),
        source: e,
    })?;
    let config = repo.config().map_err(|e| GitflowError::ConfigAccess {
        path: repo_path.display().to_string(),
        source: e,
    })?;
    Ok((repo, config))
}

fn read_required(
    config: &git2::Config,
    section: &str,
    key: &str,
    out_path: &Path,
) -> Result<Option<String>, GitflowError> {
    let composite = format!("{section}.{key}");
    match config.get_string(&composite) {
        Ok(value) => Ok(Some(value)),
        Err(err) if err.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(err) => Err(GitflowError::ConfigAccess {
            path: out_path.display().to_string(),
            source: err,
        }),
    }
}

/// Read the `[gitflow]` block. Returns `None` when no gitflow keys are
/// present in the repo's local config (treat as "not initialised").
pub fn read_gitflow_config(repo_path: &Path) -> Result<Option<GitflowConfig>, GitflowError> {
    let (_repo, config) = open_repo_config(repo_path)?;
    let master = read_required(&config, SECTION, KEY_BRANCH_MASTER, repo_path)?;
    let develop = read_required(&config, SECTION, KEY_BRANCH_DEVELOP, repo_path)?;
    let feature = read_required(&config, SECTION, KEY_PREFIX_FEATURE, repo_path)?;
    let release = read_required(&config, SECTION, KEY_PREFIX_RELEASE, repo_path)?;
    let hotfix = read_required(&config, SECTION, KEY_PREFIX_HOTFIX, repo_path)?;
    let bugfix = read_required(&config, SECTION, KEY_PREFIX_BUGFIX, repo_path)?;
    let support = read_required(&config, SECTION, KEY_PREFIX_SUPPORT, repo_path)?;
    let version_tag = read_required(&config, SECTION, KEY_PREFIX_VERSION_TAG, repo_path)?;
    let any_present = master.is_some()
        || develop.is_some()
        || feature.is_some()
        || release.is_some()
        || hotfix.is_some()
        || bugfix.is_some()
        || support.is_some()
        || version_tag.is_some();
    if !any_present {
        return Ok(None);
    }
    let defaults = GitflowConfig::defaults();
    Ok(Some(GitflowConfig {
        master_branch: master.unwrap_or(defaults.master_branch),
        develop_branch: develop.unwrap_or(defaults.develop_branch),
        feature_prefix: feature.unwrap_or(defaults.feature_prefix),
        release_prefix: release.unwrap_or(defaults.release_prefix),
        hotfix_prefix: hotfix.unwrap_or(defaults.hotfix_prefix),
        bugfix_prefix: bugfix.unwrap_or(defaults.bugfix_prefix),
        support_prefix: support.unwrap_or(defaults.support_prefix),
        version_tag_prefix: version_tag.unwrap_or(defaults.version_tag_prefix),
    }))
}

/// Write the `[gitflow]` block to the repo's local config. Every
/// field is always persisted — even when equal to a default — so a
/// subsequent read returns a stable `Some(config)` regardless of
/// `is_gitflow_initialised` heuristics.
pub fn write_gitflow_config(repo_path: &Path, config: &GitflowConfig) -> Result<(), GitflowError> {
    let repo = git2::Repository::open(repo_path).map_err(|e| GitflowError::OpenRepo {
        path: repo_path.display().to_string(),
        source: e,
    })?;
    let config_path = repo.path().join("config");
    let mut local = git2::Config::open(&config_path).map_err(|e| GitflowError::ConfigAccess {
        path: config_path.display().to_string(),
        source: e,
    })?;
    let pairs = [
        (KEY_BRANCH_MASTER, config.master_branch.as_str()),
        (KEY_BRANCH_DEVELOP, config.develop_branch.as_str()),
        (KEY_PREFIX_FEATURE, config.feature_prefix.as_str()),
        (KEY_PREFIX_RELEASE, config.release_prefix.as_str()),
        (KEY_PREFIX_HOTFIX, config.hotfix_prefix.as_str()),
        (KEY_PREFIX_BUGFIX, config.bugfix_prefix.as_str()),
        (KEY_PREFIX_SUPPORT, config.support_prefix.as_str()),
        (KEY_PREFIX_VERSION_TAG, config.version_tag_prefix.as_str()),
    ];
    for (key, value) in pairs {
        let composite = format!("{SECTION}.{key}");
        local
            .set_str(&composite, value)
            .map_err(|e| GitflowError::ConfigMutate {
                path: config_path.display().to_string(),
                source: e,
            })?;
    }
    Ok(())
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
    fn read_returns_none_when_no_gitflow_keys() {
        let dir = init_repo();
        let config = read_gitflow_config(dir.path()).unwrap();
        assert_eq!(config, None);
    }

    #[test]
    fn write_then_read_roundtrips_with_defaults() {
        let dir = init_repo();
        let defaults = GitflowConfig::defaults();
        write_gitflow_config(dir.path(), &defaults).unwrap();
        let loaded = read_gitflow_config(dir.path()).unwrap();
        assert_eq!(loaded.as_ref(), Some(&defaults));
    }

    #[test]
    fn write_then_read_roundtrips_with_custom() {
        let dir = init_repo();
        let custom = GitflowConfig {
            master_branch: "trunk".to_string(),
            develop_branch: "dev".to_string(),
            feature_prefix: "feat/".to_string(),
            release_prefix: "rel/".to_string(),
            hotfix_prefix: "fix/".to_string(),
            bugfix_prefix: "bugfix/".to_string(),
            support_prefix: "long-term/".to_string(),
            version_tag_prefix: "".to_string(),
        };
        write_gitflow_config(dir.path(), &custom).unwrap();
        let loaded = read_gitflow_config(dir.path()).unwrap();
        assert_eq!(loaded.as_ref(), Some(&custom));
    }

    #[test]
    fn read_fills_missing_keys_with_defaults_when_partial() {
        // Someone wrote `[gitflow]` manually but only set a couple of
        // keys (e.g. third-party tooling). Read must still surface a
        // full config — missing keys fall back to documented defaults.
        let dir = init_repo();
        let repo = git2::Repository::open(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("gitflow.branch.master", "trunk").unwrap();
        let loaded = read_gitflow_config(dir.path()).unwrap().unwrap();
        assert_eq!(loaded.master_branch, "trunk");
        // Default for develop survives.
        assert_eq!(loaded.develop_branch, "develop");
        assert_eq!(loaded.feature_prefix, "feature/");
    }

    #[test]
    fn defaults_match_post_2020_convention() {
        let d = GitflowConfig::defaults();
        assert_eq!(d.master_branch, "main");
        assert_eq!(d.develop_branch, "develop");
        assert_eq!(d.feature_prefix, "feature/");
        assert_eq!(d.release_prefix, "release/");
        assert_eq!(d.hotfix_prefix, "hotfix/");
        assert_eq!(d.bugfix_prefix, "bugfix/");
        assert_eq!(d.support_prefix, "support/");
        assert_eq!(d.version_tag_prefix, "v");
    }
}
