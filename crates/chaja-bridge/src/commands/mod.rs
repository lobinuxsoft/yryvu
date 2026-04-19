// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri command surface, grouped by Git-operation domain. Each submodule
//! owns its `#[tauri::command]` wrappers; this barrel re-exports them so the
//! `invoke_handler` registration in `src-tauri/src/lib.rs` and any other
//! caller continues to reach them as `chaja_bridge::commands::foo`.

mod branches;
mod commits;
mod merge;
mod remote;
mod worktree;

pub use branches::*;
pub use commits::*;
pub use merge::*;
pub use remote::*;
pub use worktree::*;
