// SPDX-License-Identifier: AGPL-3.0-or-later

//! Rebase ops. `onto` covers the GK happy-path (non-interactive
//! rebase HEAD → target with abort-on-conflict). `interactive` exposes
//! the planned rewrite flow (pick/reword/squash/fixup/edit/drop) on
//! top of libgit2 primitives — libgit2 has no todo-list editor, so
//! the orchestrator is custom (cherry-pick + amend + drop) instead of
//! shelling out to `git rebase -i`.

mod onto;
pub use onto::rebase_current_onto;

pub mod interactive;
