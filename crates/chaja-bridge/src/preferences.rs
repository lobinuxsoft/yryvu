// SPDX-License-Identifier: AGPL-3.0-or-later

//! User preferences persistence.
//!
//! Stores the chajá preferences struct as a JSON file under the platform
//! config dir (`~/.config/<bundle>/preferences.json` on Linux, the
//! equivalent on macOS / Windows via Tauri's `app_config_dir`).
//!
//! # Why a single JSON
//!
//! GitKraken splits preferences across multiple Redux slices and a
//! profile-scoped DB; chajá's surface is small enough that a single
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
//! who downgrades chajá doesn't silently lose newer settings. Bumping
//! the schema version is required when a load-time migration is
//! introduced; additive fields don't need it.

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
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
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
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            general: GeneralPreferences::default(),
            ui: UiPreferences::default(),
            tabs: TabsPreferences::default(),
        }
    }
}

fn default_version() -> u32 {
    SCHEMA_VERSION
}

/// General preferences (issue #102). Empty in this PR — extended by #102
/// with the concrete settings GK exposes under `GeneralPreferences`.
///
/// An earlier draft shipped a destructive-ops confirmation toggle
/// claiming to mirror GK's `confirmDestructiveActions`, but that flag
/// does not exist in the GK 12.0.1 bundle — see #195 for the rip and
/// #196 for the per-dialog `doNotAskAgain` pattern that replaces it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralPreferences {}

/// UI preferences (issue #103). Theme lands here in #292 (sub-PR A);
/// zoom (#293), density (#294), tooltips/animations (#295) follow.
///
/// `theme` is a [`ThemeId`] — any built-in id, custom id, or `"auto"`.
/// `"auto"` resolves at runtime against `prefers-color-scheme`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    #[serde(default = "default_theme")]
    pub theme: ThemeId,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            theme: default_theme(),
        }
    }
}

/// Theme identifier — accepts any built-in id, custom id, or `"auto"`.
/// Validation is loader-side: an unknown id triggers the self-healing
/// fallback chain (see `themes::loader`).
pub type ThemeId = String;

fn default_theme() -> ThemeId {
    "auto".to_string()
}

/// Transient tab variant. Ports GK's `tabTypes` (cited bundle:228930-228943),
/// minus CLI (no terminal in chajá) and FOCUS_VIEW (GK-proprietary).
/// REPO_MANAGEMENT lives in [`PermanentTabs`], not here — it's a singleton.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum Tab {
    #[serde(rename = "REPO", rename_all = "camelCase")]
    Repo {
        id: String,
        repo_path: String,
        #[serde(default)]
        is_worktree: bool,
    },
    #[serde(rename = "NEW", rename_all = "camelCase")]
    New { id: String },
    #[serde(rename = "RELEASE_NOTES", rename_all = "camelCase")]
    ReleaseNotes { id: String, version: String },
}

/// Singleton state for a permanent tab. Only `closed` matters; the type
/// and id are implied by the parent field name in [`PermanentTabs`].
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermanentTabState {
    pub closed: bool,
}

/// Permanent tabs (singletons). Currently only REPO_MANAGEMENT — FOCUS_VIEW
/// is skipped per `docs/research/gitkraken-tabs/11-out-of-scope-proprietary.md`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermanentTabs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_management: Option<PermanentTabState>,
}

/// Tab system state (issue #203, umbrella #135). Three fields persisted —
/// matches GK's `tabInfo` envelope at bundle:2373-2381. `closedTabs` is
/// deliberately NOT persisted (in-memory only — see audit doc 06).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TabsPreferences {
    #[serde(default)]
    pub tabs: Vec<Tab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_tab_id: Option<String>,
    #[serde(default)]
    pub permanent_tabs: PermanentTabs,
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
