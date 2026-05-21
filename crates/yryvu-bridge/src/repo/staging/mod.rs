// SPDX-License-Identifier: AGPL-3.0-or-later

//! Working-tree staging and commit-creation ops, split into focused
//! submodules:
//!
//! - [`types`]   — `CommitOptions`, `WorkingTreeChange`, `WorkingTreeStatus`.
//! - [`status`]  — `dirty_summary`, `working_tree_status`.
//! - [`stage`]   — `stage_*` / `unstage_*` / `discard_paths`.
//! - [`commit`]  — `create_commit` + thin wrappers + `commit_and_push` +
//!   `head_commit_message`.
//! - [`diff`]    — single-file `diff_unstaged` / `diff_staged`.
//!
//! **Backend choice — why git2 dominates this module (as of gix 0.68)**:
//!
//! Yryvu's rule is gix-primary, git2 only for ops gix hasn't stabilised
//! yet. For every function here the verification found gix still missing
//! a piece of the pipeline — so they all live on git2 until gix catches
//! up. Each function carries a `BACKEND: git2 — <reason>` marker so a
//! future gix-migration pass can grep and revisit them in one sweep.
//!
//! * Index read/write (add_path, remove_path, write_tree) — gix-index 0.37
//!   exposes reading but no `write_tree`-from-state. Blocks `create_commit`,
//!   `stage_*`, `unstage_*`, and the tree step of amend.
//! * Force-checkout of specific paths — gix-worktree-state 0.15 has
//!   `checkout` but no path-scoped `CheckoutBuilder::path()` equivalent.
//!   Blocks `discard_paths`.
//! * Push with refspecs + credential callbacks — gix has a remote/push
//!   surface but auth + progress are still beta. Blocks
//!   `push_current_branch` / `commit_and_push`.
//!
//! gix's `commit_as()` / `commit()` (write commit object + update HEAD
//! with reflog) are mature, but useless here without a tree id — which
//! is exactly the step gix-index still owes us.

mod commit;
mod diff;
mod partial;
mod stage;
mod status;
mod types;

pub use commit::{
    amend_commit, commit_and_push, commit_staged, create_commit, head_commit_message,
};
pub use diff::{diff_staged, diff_unstaged};
pub use partial::{
    discard_hunks, discard_lines, stage_hunks, stage_lines, unstage_hunks, unstage_lines, LineRange,
};
pub use stage::{discard_paths, stage_all, stage_files, unstage_all, unstage_files};
pub use status::{dirty_summary, working_tree_status};
pub use types::{CommitOptions, WorkingTreeChange, WorkingTreeStatus};
