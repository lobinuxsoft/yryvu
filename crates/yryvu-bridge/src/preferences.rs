// SPDX-License-Identifier: AGPL-3.0-or-later

//! User preferences persistence.
//!
//! Stores the yryvu preferences struct as a JSON file under the platform
//! config dir (`~/.config/<bundle>/preferences.json` on Linux, the
//! equivalent on macOS / Windows via Tauri's `app_config_dir`).
//!
//! # Why a single JSON
//!
//! GitKraken splits preferences across multiple Redux slices and a
//! profile-scoped DB; yryvu's surface is small enough that a single
//! file is simpler and cheaper to keep crash-safe. Each section maps to
//! a struct field with `#[serde(default)]` so adding a section in a
//! future release loads cleanly against an older file.
//!
//! # Crash safety
//!
//! Writes go through `tmp + fsync + rename`, the same pattern used by
//! the undo log sidecar (`undo_log::write_log`). A crash mid-write
//! leaves either the previous version or the new version on disk —
//! never a half-written file.
//!
//! # Schema versioning
//!
//! Each file carries a `version` field. Loaders refuse to read a file
//! whose version is *higher* than the one they know about, so a user
//! who downgrades yryvu doesn't silently lose newer settings. Bumping
//! the schema version is required when a load-time migration is
//! introduced; additive fields don't need it.
//!
//! # Module layout
//!
//! Each section lives in its own sub-module (`general`, `ui`, `tabs`,
//! `commit`, `tools`, `editor`, `notifications`) and is re-exported
//! here. The IPC contract — every name resolvable at
//! `yryvu_bridge::preferences::<Name>` — is preserved by `pub use`.

pub mod commit;
pub mod editor;
pub mod general;
pub mod issue_tracker;
pub mod notifications;
pub mod tabs;
pub mod tools;
pub mod ui;

pub use commit::CommitPreferences;
pub use editor::{EditorPreferences, EolCharacter};
pub use general::GeneralPreferences;
pub use issue_tracker::IssueTrackerPreferences;
pub use notifications::NotificationsPreferences;
pub use tabs::{PermanentTabState, PermanentTabs, Tab, TabsPreferences};
pub use tools::{
    build_terminal_spawn, ExternalTerminal, TerminalSpawnError, TerminalSpawnSpec, ToolPreferences,
};
pub use ui::{AnimationMode, Density, ThemeId, UiPreferences};

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const SCHEMA_VERSION: u32 = 1;
const FILE_NAME: &str = "preferences.json";

#[derive(Debug, Error)]
pub enum PreferencesError {
    #[error("preferences I/O failed at {path}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("preferences parse failed at {path}")]
    Parse {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("preferences schema version {got} is newer than supported (max {max})")]
    UnsupportedVersion { got: u32, max: u32 },
}

/// Top-level preferences document. Sections are flat structs grouped by
/// the corresponding tab in the Preferences window. Each section is
/// `#[serde(default)]` so a partial JSON or a file written by an older
/// version loads against the current struct without errors.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub general: GeneralPreferences,
    #[serde(default)]
    pub ui: UiPreferences,
    #[serde(default)]
    pub tabs: TabsPreferences,
    #[serde(default)]
    pub commit: CommitPreferences,
    #[serde(default)]
    pub tools: ToolPreferences,
    #[serde(default)]
    pub editor: EditorPreferences,
    #[serde(default)]
    pub notifications: NotificationsPreferences,
    #[serde(default)]
    pub issue_tracker: IssueTrackerPreferences,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            general: GeneralPreferences::default(),
            ui: UiPreferences::default(),
            tabs: TabsPreferences::default(),
            commit: CommitPreferences::default(),
            tools: ToolPreferences::default(),
            editor: EditorPreferences::default(),
            notifications: NotificationsPreferences::default(),
            issue_tracker: IssueTrackerPreferences::default(),
        }
    }
}

fn default_version() -> u32 {
    SCHEMA_VERSION
}

/// Resolve the absolute path of the preferences file in `dir`.
pub fn file_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Load preferences from `<dir>/preferences.json`. Returns
/// `Preferences::default()` when the file doesn't exist (first run).
/// Errors if the file exists but is unparseable or claims a newer schema.
pub fn load(dir: &Path) -> Result<Preferences, PreferencesError> {
    let path = file_path(dir);
    if !path.exists() {
        return Ok(Preferences::default());
    }
    let bytes = fs::read(&path).map_err(|e| PreferencesError::Io {
        path: path.display().to_string(),
        source: e,
    })?;
    let prefs: Preferences =
        serde_json::from_slice(&bytes).map_err(|e| PreferencesError::Parse {
            path: path.display().to_string(),
            source: e,
        })?;
    if prefs.version > SCHEMA_VERSION {
        return Err(PreferencesError::UnsupportedVersion {
            got: prefs.version,
            max: SCHEMA_VERSION,
        });
    }
    Ok(prefs)
}

/// Save preferences atomically: write to `*.tmp`, fsync, rename. Same
/// crash-safety guarantees as [`crate::undo_log::record_op`].
pub fn save(dir: &Path, prefs: &Preferences) -> Result<(), PreferencesError> {
    fs::create_dir_all(dir).map_err(|e| PreferencesError::Io {
        path: dir.display().to_string(),
        source: e,
    })?;
    let final_path = file_path(dir);
    let tmp_path = final_path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(prefs).map_err(|e| PreferencesError::Parse {
        path: final_path.display().to_string(),
        source: e,
    })?;
    {
        let mut tmp = fs::File::create(&tmp_path).map_err(|e| PreferencesError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
        tmp.write_all(&json).map_err(|e| PreferencesError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
        tmp.sync_all().map_err(|e| PreferencesError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
    }
    fs::rename(&tmp_path, &final_path).map_err(|e| PreferencesError::Io {
        path: final_path.display().to_string(),
        source: e,
    })
}

/// Reset preferences to defaults and persist them. Equivalent to
/// deleting the file and calling [`load`], but goes through the same
/// atomic write so a crash mid-reset still leaves a valid file on disk.
pub fn reset(dir: &Path) -> Result<Preferences, PreferencesError> {
    let prefs = Preferences::default();
    save(dir, &prefs)?;
    Ok(prefs)
}
