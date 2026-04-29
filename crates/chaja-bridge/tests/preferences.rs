// SPDX-License-Identifier: AGPL-3.0-or-later

//! Integration tests for `chaja_bridge::preferences`. Cover the contract
//! the IPC layer relies on: missing file → defaults, roundtrip, partial
//! JSON loads via `#[serde(default)]`, and version-newer rejection.

use chaja_bridge::preferences::{file_path, load, reset, save, Preferences, PreferencesError};
use tempfile::TempDir;

#[test]
fn load_returns_default_when_file_missing() {
    let dir = TempDir::new().unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs, Preferences::default());
    assert!(prefs.general.confirm_destructive_ops);
}

#[test]
fn save_then_load_roundtrips() {
    let dir = TempDir::new().unwrap();
    let mut prefs = Preferences::default();
    prefs.general.confirm_destructive_ops = false;
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
    // Both sections fall back to their `Default` impl, which means
    // `confirm_destructive_ops = true` survives an empty `general`.
    assert!(prefs.general.confirm_destructive_ops);
    assert_eq!(prefs.ui, Default::default());
}

#[test]
fn missing_field_inside_section_falls_back_to_default() {
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1, "general": {}}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert!(prefs.general.confirm_destructive_ops);
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
    let mut prefs = Preferences::default();
    prefs.general.confirm_destructive_ops = false;
    save(dir.path(), &prefs).unwrap();

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

#[test]
fn camel_case_serialization() {
    // The IPC contract sends camelCase fields to the frontend; verify
    // the rename rolls through `confirm_destructive_ops`.
    let json = serde_json::to_string(&Preferences::default()).unwrap();
    assert!(
        json.contains("confirmDestructiveOps"),
        "expected camelCase field in {json}"
    );
}
