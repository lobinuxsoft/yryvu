// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;

use super::common::{git2_err, open_git2, validate_tag_name};

/// Create a tag pointing at `sha`.
///
/// - `message = None` creates a lightweight tag (plain ref under `refs/tags/`).
/// - `message = Some(..)` creates a proper annotated tag object signed by the
///   configured `user.name` / `user.email`.
pub fn create_tag(
    repo_path: &Path,
    name: &str,
    sha: &str,
    message: Option<&str>,
) -> Result<(), BackendError> {
    validate_tag_name(name)?;
    let repo = open_git2(repo_path)?;

    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let target = repo
        .find_object(oid, None)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;

    let full_ref = format!("refs/tags/{name}");
    if repo.find_reference(&full_ref).is_ok() {
        return Err(BackendError::TagExists {
            name: name.to_string(),
        });
    }

    match message {
        Some(msg) => {
            let sig = repo.signature().map_err(git2_err)?;
            repo.tag(name, &target, &sig, msg, false)
                .map_err(git2_err)?;
        }
        None => {
            repo.tag_lightweight(name, &target, false)
                .map_err(git2_err)?;
        }
    }

    Ok(())
}
