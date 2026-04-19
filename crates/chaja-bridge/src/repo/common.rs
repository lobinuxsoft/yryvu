// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;

pub(super) fn open_git2(path: &Path) -> Result<git2::Repository, BackendError> {
    git2::Repository::open(path).map_err(|e| BackendError::Open {
        path: path.display().to_string(),
        source: anyhow::Error::new(e),
    })
}

pub(super) fn git2_err(e: git2::Error) -> BackendError {
    BackendError::Git(anyhow::Error::new(e))
}

pub(super) fn short_sha(oid: &git2::Oid) -> String {
    oid.to_string().chars().take(7).collect()
}

pub(super) fn open_repo(path: &Path) -> Result<gix::Repository, BackendError> {
    gix::open(path).map_err(|e| BackendError::Open {
        path: path.display().to_string(),
        source: anyhow::Error::new(e),
    })
}

pub(super) fn validate_branch_name(name: &str) -> Result<(), BackendError> {
    if name.is_empty()
        || name.starts_with('-')
        || name.contains("..")
        || name.contains(' ')
        || name.contains('\t')
        || name.contains('~')
        || name.contains('^')
        || name.contains(':')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.contains('\\')
        || name.ends_with('/')
        || name.ends_with(".lock")
    {
        return Err(BackendError::InvalidBranchName {
            name: name.to_string(),
        });
    }
    Ok(())
}
