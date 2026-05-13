// SPDX-License-Identifier: AGPL-3.0-or-later

//! Integration tests for `yryvu_bridge::preferences`. Cover the contract
//! the IPC layer relies on: missing file → defaults, roundtrip, partial
//! JSON loads via `#[serde(default)]`, unknown-field tolerance, and
//! version-newer rejection.
//!
//! Split from a 1117 LoC single file in #349 — each section now owns
//! its own module under this directory. This `main.rs` keeps only the
//! cross-cutting tests (I/O envelope, schema-version gate, reset) and
//! the `mod` declarations.

mod commit;
mod editor;
mod general;
mod issue_tracker;
mod notifications;
mod tabs;
mod tools;
mod ui;

use tempfile::TempDir;
use yryvu_bridge::preferences::{
    file_path, load, reset, save, GeneralPreferences, Preferences, PreferencesError, UiPreferences,
};

#[test]
fn load_returns_default_when_file_missing() {
    let dir = TempDir::new().unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs, Preferences::default());
}

#[test]
fn save_then_load_roundtrips() {
    // With both sections currently empty, the roundtrip just exercises
    // the I/O path. Re-extend with mutated state when GeneralPreferences
    // or UiPreferences ship their first field.
    let dir = TempDir::new().unwrap();
    let prefs = Preferences::default();
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded, prefs);
}

#[test]
fn save_creates_directory_when_missing() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("does/not/exist/yet");
    save(&nested, &Preferences::default()).unwrap();
    assert!(file_path(&nested).exists());
}

#[test]
fn partial_json_loads_with_section_defaults() {
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.general, GeneralPreferences::default());
    assert_eq!(prefs.ui, UiPreferences::default());
}

#[test]
fn unknown_field_inside_section_is_ignored() {
    // Future-rollback safety: a JSON file written by a newer yryvu that
    // contains fields the current binary doesn't know about must load
    // cleanly. Serde's default behavior drops unknown fields silently.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "general": {"unknownFutureField": true}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.general, GeneralPreferences::default());
}

#[test]
fn unsupported_future_version_errors() {
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 99}"#).unwrap();
    let err = load(dir.path()).unwrap_err();
    assert!(matches!(
        err,
        PreferencesError::UnsupportedVersion { got: 99, max: 1 }
    ));
}

#[test]
fn malformed_json_errors() {
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), "{not json").unwrap();
    let err = load(dir.path()).unwrap_err();
    assert!(matches!(err, PreferencesError::Parse { .. }));
}

#[test]
fn reset_overwrites_existing_with_defaults() {
    let dir = TempDir::new().unwrap();
    // Seed with a JSON that carries an unknown field — `reset` must
    // strip it down to a clean defaults file regardless of prior state.
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "general": {"strayField": 42}}"#,
    )
    .unwrap();

    let resetted = reset(dir.path()).unwrap();
    assert_eq!(resetted, Preferences::default());

    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded, Preferences::default());
}

#[test]
fn save_atomicity_no_tmp_left_behind() {
    let dir = TempDir::new().unwrap();
    save(dir.path(), &Preferences::default()).unwrap();
    let stray_tmp = file_path(dir.path()).with_extension("json.tmp");
    assert!(!stray_tmp.exists(), "tmp file should be renamed away");
}
