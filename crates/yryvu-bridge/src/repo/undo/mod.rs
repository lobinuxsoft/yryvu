// SPDX-License-Identifier: AGPL-3.0-or-later

//! Inverse builder for the undo log.
//!
//! Sub-PR 2 of issue #130: reads the sidecar that sub-PR 1 (#183 / #184)
//! populates and runs the inverse of the most-recent op when the user
//! clicks `Undo` in the toolbar.
//!
//! # What "inverse" means per OpKind
//!
//! | Op                          | Inverse                                              |
//! |-----------------------------|------------------------------------------------------|
//! | `Commit { parent: Some }`   | `reset --soft parent_sha` — preserves index + worktree |
//! | `Commit { parent: None }`   | not supported (root commit, no parent to step back to) |
//! | `Amend`                     | `reset --hard old_sha` — recovers the pre-amend commit |
//! | `CheckoutBranch`            | `checkout_branch(from)`                              |
//! | `CheckoutCommit`            | `checkout_branch(from)` (or `checkout_commit(from)` if `from` was a SHA) |
//! | `Reset`                     | `reset_to_commit(from_sha, original_mode)` — same mode reverses the same way |
//! | `CherryPick` / `Revert`     | `reset --hard <parent of recorded new_sha>` — verified against HEAD first |
//! | `Merge`                     | `reset --hard pre_merge_sha`                         |
//! | `StashPush`                 | `stash_pop` — re-applies what we just stashed        |
//! | `StashPop`                  | not supported in sub-PR 2 — re-stashing safely needs a heavier index/worktree snapshot than libgit2's `stash_save2` provides |
//!
//! # Module layout
//!
//! - [`inverse`] — the undo direction (`apply_inverse`).
//! - [`redo`] — the redo direction (`apply_redo`).
//! - [`shared`] — the outcome type, the dirty-tree guard, and the
//!   soft/hard reset helpers both directions use.
//!
//! # What this module does NOT do
//!
//! - Walk the cursor — that's the IPC layer's job (`commands/undo.rs`).
//! - Record an inverse-of-inverse op — undo moves the cursor; the redo
//!   path uses the same entries.
//! - Reconstruct content that was never committed. A `reset --hard` does
//!   NOT refuse over a dirty working tree — libgit2's `reset.c` forces
//!   `GIT_CHECKOUT_FORCE` regardless of caller options, and discarding
//!   local changes is what the mode is for. Destructive inverses are
//!   therefore gated on `guard_dirty`, which refuses unless the caller
//!   passes `force` to say the user was asked and accepted.

mod inverse;
mod redo;
mod shared;

pub use inverse::apply_inverse;
pub use redo::apply_redo;
pub use shared::UndoOutcome;

#[cfg(test)]
mod tests;
