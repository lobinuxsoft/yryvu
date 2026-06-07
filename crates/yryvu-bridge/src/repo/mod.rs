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
pub(crate) mod blame;
mod branches;
pub(crate) mod checkout_file;
pub(crate) mod clone;
pub(crate) mod commits;
pub(crate) mod common;
pub(crate) mod config_custom;
pub(crate) mod conflicts;
pub(crate) mod file_content;
pub(crate) mod file_history;
pub(crate) mod gitflow;
pub(crate) mod hooks;
pub(crate) mod hosting;
pub(crate) mod init;
mod merge;
mod patches;
pub(crate) mod rebase;
pub(crate) mod reflog;
pub(crate) mod remote;
pub(crate) mod search;
pub(crate) mod smart_branches;
pub(crate) mod sparse_checkout;
pub(crate) mod staging;
mod stashes;
mod submodules;
mod tags;
pub(crate) mod undo;
mod worktree;
mod worktrees;

#[derive(Debug, Default, Clone, Copy)]
pub struct GixBackend;
