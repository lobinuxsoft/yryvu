// SPDX-License-Identifier: AGPL-3.0-or-later

//! Thin wrapper around `git2::Config` for reading / writing custom
//! sections in a repository's `.git/config` (e.g. `[yryvu]`-namespaced
//! keys for per-repo preferences overrides).
//!
//! Gix's config reader is good for static loads but mutation is still
//! green-field in the library; git2 has a stable `Config::set_str` /
//! `remove_multivar` pair we can rely on.
//!
//! The functions here are deliberately tiny: callers stringify the
//! section + key and we round-trip a free-form `String`. Validation
//! (URL pattern shape, etc.) belongs to the caller, not the storage
//! layer.

use std::path::Path;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CustomConfigError {
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
}

fn open_repo_config(repo_path: &Path) -> Result<git2::Config, CustomConfigError> {
    let repo = git2::Repository::open(repo_path).map_err(|e| CustomConfigError::OpenRepo {
        path: repo_path.display().to_string(),
        source: e,
    })?;
    repo.config().map_err(|e| CustomConfigError::ConfigAccess {
        path: repo_path.display().to_string(),
        source: e,
    })
}

/// Read `<section>.<key>` from the repository's config. Returns `None`
/// when the key is absent — a missing key is the common case and is
/// not an error. Wrapping I/O errors are surfaced.
pub fn read_custom_value(
    repo_path: &Path,
    section: &str,
    key: &str,
) -> Result<Option<String>, CustomConfigError> {
    let config = open_repo_config(repo_path)?;
    let composite = format!("{section}.{key}");
    match config.get_string(&composite) {
        Ok(value) => Ok(Some(value)),
        Err(err) if err.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(err) => Err(CustomConfigError::ConfigAccess {
            path: repo_path.display().to_string(),
            source: err,
        }),
    }
}

/// Write `<section>.<key>` into the **local** config of the repo at
/// `repo_path`. Passing `None` removes the key entirely (idempotent —
/// absent keys are not an error).
pub fn write_custom_value(
    repo_path: &Path,
    section: &str,
    key: &str,
    value: Option<&str>,
) -> Result<(), CustomConfigError> {
    let repo = git2::Repository::open(repo_path).map_err(|e| CustomConfigError::OpenRepo {
        path: repo_path.display().to_string(),
        source: e,
    })?;
    // Local config (the repo's own `.git/config`), not the global /
    // system files — per-repo overrides must not leak into other repos.
    let config_path = repo
        .path()
        .join("config")
        .canonicalize()
        .map_err(|e| CustomConfigError::ConfigAccess {
            path: repo.path().join("config").display().to_string(),
            source: git2::Error::from_str(&e.to_string()),
        })?;
    let mut local =
        git2::Config::open(&config_path).map_err(|e| CustomConfigError::ConfigAccess {
            path: config_path.display().to_string(),
            source: e,
        })?;
    let composite = format!("{section}.{key}");
    match value {
        Some(v) => local
            .set_str(&composite, v)
            .map_err(|e| CustomConfigError::ConfigMutate {
                path: config_path.display().to_string(),
                source: e,
            }),
        None => {
            // `remove_multivar` removes every value; for a single-value
            // key that's equivalent to `unset`. NotFound is fine —
            // already absent is the intended state.
            match local.remove_multivar(&composite, ".*") {
                Ok(()) => Ok(()),
                Err(err) if err.code() == git2::ErrorCode::NotFound => Ok(()),
                Err(err) => Err(CustomConfigError::ConfigMutate {
                    path: config_path.display().to_string(),
                    source: err,
                }),
            }
        }
    }
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
    fn read_missing_key_returns_none() {
        let dir = init_repo();
        let value = read_custom_value(dir.path(), "yryvu", "issueTrackerUrl").unwrap();
        assert_eq!(value, None);
    }

    #[test]
    fn write_then_read_roundtrips() {
        let dir = init_repo();
        write_custom_value(
            dir.path(),
            "yryvu",
            "issueTrackerUrl",
            Some("https://example.com/issues/{id}"),
        )
        .unwrap();
        let value = read_custom_value(dir.path(), "yryvu", "issueTrackerUrl").unwrap();
        assert_eq!(value.as_deref(), Some("https://example.com/issues/{id}"));
    }

    #[test]
    fn write_none_removes_key() {
        let dir = init_repo();
        write_custom_value(dir.path(), "yryvu", "issueTrackerUrl", Some("x")).unwrap();
        write_custom_value(dir.path(), "yryvu", "issueTrackerUrl", None).unwrap();
        let value = read_custom_value(dir.path(), "yryvu", "issueTrackerUrl").unwrap();
        assert_eq!(value, None);
    }

    #[test]
    fn write_none_on_absent_key_is_noop() {
        let dir = init_repo();
        // Should not error even though the key doesn't exist.
        write_custom_value(dir.path(), "yryvu", "issueTrackerUrl", None).unwrap();
    }

    #[test]
    fn write_overwrites_previous_value() {
        let dir = init_repo();
        write_custom_value(dir.path(), "yryvu", "issueTrackerUrl", Some("old")).unwrap();
        write_custom_value(dir.path(), "yryvu", "issueTrackerUrl", Some("new")).unwrap();
        let value = read_custom_value(dir.path(), "yryvu", "issueTrackerUrl").unwrap();
        assert_eq!(value.as_deref(), Some("new"));
    }
}
