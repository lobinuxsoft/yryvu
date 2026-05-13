// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri command surface, grouped by Git-operation domain. Each submodule
//! owns its `#[tauri::command]` wrappers; this barrel re-exports them so the
//! `invoke_handler` registration in `src-tauri/src/lib.rs` and any other
//! caller continues to reach them as `yryvu_bridge::commands::foo`.

mod branches;
mod cli_import;
mod clone;
mod commits;
mod hooks;
mod init;
mod integrations;
mod issue_tracker;
mod merge;
mod preferences;
mod release_notes;
mod remote;
mod repo_management;
mod smart_branches;
mod staging;
mod stashes;
mod submodules;
mod tags;
mod templates;
mod themes;
mod tools;
mod undo;
mod validate;
mod worktree;
mod worktrees;

pub use branches::*;
pub use cli_import::*;
pub use clone::*;
pub use commits::*;
pub use hooks::*;
pub use init::*;
pub use integrations::*;
pub use issue_tracker::*;
pub use merge::*;
pub use preferences::*;
pub use release_notes::*;
pub use remote::*;
pub use repo_management::*;
pub use smart_branches::*;
pub use staging::*;
pub use stashes::*;
pub use submodules::*;
pub use tags::*;
pub use templates::*;
pub use themes::*;
pub use tools::*;
pub use undo::*;
pub use validate::*;
pub use worktree::*;
pub use worktrees::*;
