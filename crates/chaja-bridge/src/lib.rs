// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri command surface for chaja — bridges the frontend to `gix` via `graph-core`.

pub mod backend;
pub mod commands;
pub mod integrations;
pub mod preferences;
pub mod repo;
pub mod templates;
pub mod themes;
pub mod undo_log;

pub use backend::{GitBackend, GixBackend};
