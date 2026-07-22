// SPDX-License-Identifier: AGPL-3.0-or-later

//! Backend abstraction split into focused submodules:
//!
//! - [`errors`] — the [`BackendError`] enum.
//! - [`types`] — every data type the backend exposes (refs, diffs,
//!   commits, options, …).
//! - [`git_backend`] — the [`GitBackend`] trait.
//!
//! Re-exports preserve the flat `crate::backend::*` import surface.

mod errors;
mod git_backend;
mod types;

pub use errors::BackendError;
pub use git_backend::GitBackend;
pub use types::*;

pub use crate::repo::blame::{BlameLine, FileBlame};
pub use crate::repo::commits::{AuthorInfo, RECENT_AUTHORS_DEFAULT_LIMIT};
pub use crate::repo::file_bytes::FileBytes;
pub use crate::repo::file_content::{FileContent, FileContentSource};
pub use crate::repo::file_history::FileHistoryEntry;
pub use crate::repo::remote::{FetchReport, RemoteFetchFailure, RemoteInfo};
pub use crate::repo::staging::{
    CommitOptions, GenerateKeyRequest, GeneratedKey, GpgKeyInfo, LineRange, SignConfig, SignFormat,
    WorkingTreeChange, WorkingTreeStatus,
};
pub use crate::repo::GixBackend;
