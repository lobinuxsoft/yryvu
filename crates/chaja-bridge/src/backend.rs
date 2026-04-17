// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use graph_core::Commit;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BackendError {
    #[error("failed to open repository at {path}: {source}")]
    Open {
        path: String,
        #[source]
        source: anyhow::Error,
    },
    #[error("revwalk failed: {0}")]
    Revwalk(#[source] anyhow::Error),
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),
}

/// Shared surface every Git backend must implement.
///
/// `gix` is the primary backend; `git2-rs` / shell-out variants exist to cover operations
/// not yet production-ready in gitoxide (e.g. interactive rebase — issue #11).
pub trait GitBackend: Send + Sync {
    fn walk_commits(
        &self,
        repo_path: &Path,
    ) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError>;
}

pub use crate::repo::GixBackend;
