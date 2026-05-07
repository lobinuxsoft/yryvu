// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filesystem watcher for `<app-config>/themes/`. Emits a `theme-changed`
//! Tauri event whenever the directory contents shift.
//!
//! Debounced via `notify-debouncer-full` at 200 ms — long enough that
//! editor save bursts (vim atomic-rename, VS Code multi-write) collapse
//! into a single event, short enough that "save → see in app" feels live.
//!
//! The frontend listens for `theme-changed` and re-fetches the theme
//! list + the active theme's CSS (see `apps/chaja-app/src/themes/state.ts`).

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{Debouncer, RecommendedCache, new_debouncer};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tracing::{debug, warn};

const DEBOUNCE_MS: u64 = 200;

/// Tauri event name emitted on filesystem changes inside the themes dir.
pub const THEME_CHANGED_EVENT: &str = "theme-changed";

#[derive(Debug, Error)]
pub enum WatcherError {
    #[error("failed to create themes directory `{path}`")]
    CreateDir {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("notify watcher initialization failed")]
    Init(#[from] notify::Error),
}

/// RAII handle wrapping the running watcher. Drop it (or let Tauri's
/// state manager drop it on app shutdown) and the watcher tears down.
pub struct ThemeWatcher {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

/// Start a debounced watcher on `<config>/themes/`. The directory is
/// created if it doesn't exist yet — the watcher needs a real path.
/// Returns an opaque handle the caller must hold (e.g. via
/// `app.manage(...)`); dropping it stops the watcher.
pub fn start_watcher(
    app: AppHandle,
    themes_dir: &Path,
) -> Result<ThemeWatcher, WatcherError> {
    if !themes_dir.exists() {
        std::fs::create_dir_all(themes_dir).map_err(|e| WatcherError::CreateDir {
            path: themes_dir.display().to_string(),
            source: e,
        })?;
    }

    let app_for_handler = Arc::new(app);
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: notify_debouncer_full::DebounceEventResult| match result {
            Ok(events) if !events.is_empty() => {
                debug!(?events, "themes dir changed, emitting {THEME_CHANGED_EVENT}");
                if let Err(e) = app_for_handler.emit(THEME_CHANGED_EVENT, ()) {
                    warn!("failed to emit {THEME_CHANGED_EVENT}: {e}");
                }
            }
            Ok(_) => {}
            Err(errors) => {
                warn!(?errors, "themes watcher reported errors");
            }
        },
    )?;

    debouncer.watch(themes_dir, RecursiveMode::Recursive)?;

    Ok(ThemeWatcher { _debouncer: debouncer })
}
