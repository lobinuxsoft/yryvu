// SPDX-License-Identifier: AGPL-3.0-or-later

//! gix + git2 hybrid Git backend. The individual submodules hold the actual
//! logic, grouped by domain:
//!
//! - [`commits`] — history walk + per-commit diff.
//! - [`branches`] — local / remote branch listing + CRUD + tracking counters.
//! - [`worktree`] — dirty detection, checkout, stash, abort-merge, repo state.
//! - [`merge`] — three-strategy merge.
//! - [`remote`] — push-delete + fetch-with-prune (shares credential resolution).
//! - [`common`] — tiny helpers used across modules: repo open, error mapping,
//!   ref-name validation, short-sha formatting.
//!
//! [`GixBackend`] implements [`GitBackend`] in `backend_impl.rs` (a separate
//! file so this index stays focused on module wiring).

mod backend_impl;
mod branches;
pub(crate) mod commits;
pub(crate) mod common;
pub(crate) mod hosting;
mod merge;
mod patches;
mod rebase;
pub(crate) mod reflog;
mod remote;
pub(crate) mod smart_branches;
pub(crate) mod staging;
mod stashes;
mod submodules;
mod tags;
pub(crate) mod undo;
mod worktree;
mod worktrees;

#[derive(Debug, Default, Clone, Copy)]
pub struct GixBackend;
