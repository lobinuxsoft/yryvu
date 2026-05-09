// SPDX-License-Identifier: AGPL-3.0-or-later

//! Theme system for chajá — folder-based, with compile-time embedded
//! built-ins and runtime-loaded custom themes.
//!
//! See `docs/research/gitkraken-ui-preferences/01-theme-preference.md`
//! for the design rationale and citations against the GitKraken bundle.

pub mod loader;
pub mod schema;
pub mod watcher;

pub use loader::{LoadError, ThemeCss, ThemeEntry};
pub use schema::{Scheme, ThemeMetadata};
pub use watcher::{start_watcher, ThemeWatcher, WatcherError, THEME_CHANGED_EVENT};
