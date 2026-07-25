// SPDX-License-Identifier: AGPL-3.0-or-later

//! Data types crossing the Tauri IPC boundary, grouped by domain:
//!
//! - [`entities`] — branches, tags, stashes, worktrees, submodules,
//!   commit metadata.
//! - [`ops`] — operation inputs/results (reset, push, merge, repo state,
//!   apply-patch).
//! - [`diff`] — per-file and combined diff shapes.
//!
//! Everything is re-exported flat so callers keep using
//! `crate::backend::<Type>` unchanged.

mod diff;
mod entities;
mod ops;

pub use diff::*;
pub use entities::*;
pub use ops::*;
