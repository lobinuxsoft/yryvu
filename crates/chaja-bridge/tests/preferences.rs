// SPDX-License-Identifier: AGPL-3.0-or-later

//! Integration tests for `chaja_bridge::preferences`. Cover the contract
//! the IPC layer relies on: missing file → defaults, roundtrip, partial
//! JSON loads via `#[serde(default)]`, unknown-field tolerance, and
//! version-newer rejection.

use chaja_bridge::preferences::{
    file_path, load, reset, save, Density, GeneralPreferences, PermanentTabState, PermanentTabs,
    Preferences, PreferencesError, Tab, TabsPreferences, UiPreferences,
};
use tempfile::TempDir;

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
    // Future-rollback safety: a JSON file written by a newer chajá that
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

#[test]
fn tabs_envelope_roundtrips_with_repo_and_permanent() {
    // Issue #203 — verify the tab system envelope persists end-to-end:
    // a transient REPO tab + the REPO_MANAGEMENT permanent singleton +
    // a selected_tab_id pointing at the permanent tab.
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        tabs: TabsPreferences {
            tabs: vec![Tab::Repo {
                id: "uuid-1".into(),
                repo_path: "/tmp/example".into(),
                is_worktree: false,
            }],
            selected_tab_id: Some("REPO_MANAGEMENT".into()),
            permanent_tabs: PermanentTabs {
                repo_management: Some(PermanentTabState { closed: false }),
            },
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded, prefs);
}

#[test]
fn tabs_section_camel_case_wire_format() {
    // The IPC contract is camelCase. If serde renames drift, the
    // frontend's TabsPreferences interface stops matching silently — CI
    // catches it here instead of at runtime.
    let prefs = Preferences {
        tabs: TabsPreferences {
            tabs: vec![Tab::Repo {
                id: "x".into(),
                repo_path: "/p".into(),
                is_worktree: true,
            }],
            selected_tab_id: Some("x".into()),
            permanent_tabs: PermanentTabs {
                repo_management: Some(PermanentTabState { closed: true }),
            },
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    assert!(json.contains("\"selectedTabId\""), "got {json}");
    assert!(json.contains("\"permanentTabs\""), "got {json}");
    assert!(json.contains("\"repoManagement\""), "got {json}");
    assert!(json.contains("\"isWorktree\""), "got {json}");
    assert!(json.contains("\"type\":\"REPO\""), "got {json}");
}

#[test]
fn tabs_release_notes_variant_roundtrips() {
    let prefs = Preferences {
        tabs: TabsPreferences {
            tabs: vec![Tab::ReleaseNotes {
                id: "rn-1".into(),
                version: "0.4.2".into(),
            }],
            ..TabsPreferences::default()
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    assert!(json.contains("\"type\":\"RELEASE_NOTES\""), "got {json}");
    let back: Preferences = serde_json::from_str(&json).unwrap();
    assert_eq!(back, prefs);
}

#[test]
fn ui_density_defaults_to_comfortable() {
    let prefs = Preferences::default();
    assert_eq!(prefs.ui.density, Density::Comfortable);
}

#[test]
fn ui_density_compact_roundtrips() {
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        ui: UiPreferences {
            density: Density::Compact,
            ..UiPreferences::default()
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.ui.density, Density::Compact);
}

#[test]
fn ui_density_serializes_as_camel_case() {
    // The IPC contract is camelCase. The frontend reads `density` as the
    // literal strings `"comfortable"` / `"compact"` to drive the
    // `data-density` attribute — drift would silently break theming.
    let prefs = Preferences {
        ui: UiPreferences {
            density: Density::Compact,
            ..UiPreferences::default()
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    assert!(json.contains("\"density\":\"compact\""), "got {json}");

    let prefs_default = Preferences::default();
    let json_default = serde_json::to_string(&prefs_default).unwrap();
    assert!(
        json_default.contains("\"density\":\"comfortable\""),
        "got {json_default}"
    );
}

#[test]
fn ui_density_missing_field_falls_back_to_default() {
    // A preferences file written before #294 lacks `density`. Loading
    // must fill it with `Comfortable` instead of failing.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "ui": {"theme": "auto"}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.ui.density, Density::Comfortable);
}

#[test]
fn tabs_partial_load_falls_back_to_section_defaults() {
    // A file written by an older chajá won't have the `tabs` section.
    // Loading must fill the section with TabsPreferences::default().
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "general": {}, "ui": {}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.tabs, TabsPreferences::default());
}
