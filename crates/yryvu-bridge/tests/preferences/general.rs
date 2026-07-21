// SPDX-License-Identifier: AGPL-3.0-or-later

//! General section tests.

use tempfile::TempDir;
use yryvu_bridge::preferences::{file_path, load, save, GeneralPreferences, Preferences};

#[test]
fn general_defaults_match_documented() {
    // Issue #102 — pin every default in one place so a drift in the
    // sub-struct's Default impl shows up immediately, not when a user
    // notices their preferences look different post-upgrade.
    let g = Preferences::default().general;
    assert!(g.auto_fetch_enabled);
    assert_eq!(g.auto_fetch_interval_secs, 600);
    assert!(g.auto_prune);
    assert!(!g.auto_update_submodules);
    assert!(g.conflict_detection_enabled);
    assert_eq!(g.default_branch_name, "main");
    assert!(!g.delete_orig_after_merge);
    assert!(!g.squash_on_merge);
    assert!(g.open_file_in_host);
    assert!(g.open_url_in_host);
    assert!(g.longpaths);
    assert!(g.git_config_default);
    assert!(g.remember_tabs);
    assert!(!g.use_extended_logging);
    // Confirmations are on until the user silences them (#196).
    assert!(!g.force_push_skip_second_warning);
}

#[test]
fn general_all_fields_flipped_roundtrip() {
    // Flip every bool away from its default and pick non-default values
    // for the u32 / String fields, then roundtrip. Catches any rename
    // or missing serde attribute on the way to disk.
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        general: GeneralPreferences {
            auto_fetch_enabled: false,
            auto_fetch_interval_secs: 1800,
            auto_prune: false,
            auto_update_submodules: true,
            conflict_detection_enabled: false,
            default_branch_name: "trunk".to_string(),
            delete_orig_after_merge: true,
            squash_on_merge: true,
            open_file_in_host: false,
            open_url_in_host: false,
            longpaths: false,
            git_config_default: false,
            remember_tabs: false,
            use_extended_logging: true,
            force_push_skip_second_warning: true,
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.general, prefs.general);
}

#[test]
fn general_serializes_as_camel_case() {
    // The IPC contract is camelCase. Drift on any of the multi-word
    // fields would silently break the frontend reader — assert the
    // exact wire keys the panel will look for.
    let prefs = Preferences::default();
    let json = serde_json::to_string(&prefs).unwrap();
    for key in [
        "\"autoFetchEnabled\"",
        "\"autoFetchIntervalSecs\"",
        "\"autoPrune\"",
        "\"autoUpdateSubmodules\"",
        "\"conflictDetectionEnabled\"",
        "\"defaultBranchName\"",
        "\"deleteOrigAfterMerge\"",
        "\"squashOnMerge\"",
        "\"openFileInHost\"",
        "\"openUrlInHost\"",
        "\"longpaths\"",
        "\"gitConfigDefault\"",
        "\"rememberTabs\"",
        "\"useExtendedLogging\"",
        "\"forcePushSkipSecondWarning\"",
    ] {
        assert!(json.contains(key), "missing wire key {key} in {json}");
    }
}

#[test]
fn general_missing_section_falls_back_to_defaults() {
    // A preferences file written before #102 lacks the `general`
    // section entirely. Loading must fill it with the documented
    // defaults instead of failing — same contract as the existing
    // partial-JSON test, exercised against the now-non-empty section.
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.general, GeneralPreferences::default());
}

#[test]
fn general_partial_section_fills_per_field_defaults() {
    // Per-field `#[serde(default)]` means a section with only some keys
    // present must fill the missing ones individually, not reject. A
    // user that toggled only `squashOnMerge` should not lose the rest
    // of the section on next load.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "general": {"squashOnMerge": true}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert!(prefs.general.squash_on_merge);
    assert_eq!(prefs.general.auto_fetch_interval_secs, 600);
    assert_eq!(prefs.general.default_branch_name, "main");
    assert!(prefs.general.auto_fetch_enabled);
}

#[test]
fn general_auto_fetch_interval_secs_custom_value_roundtrips() {
    // Walk the panel-gated range plus the boundaries to catch any
    // u32 width / camelCase drift on every value the UI is allowed to
    // produce.
    let dir = TempDir::new().unwrap();
    for secs in [30_u32, 60, 300, 600, 1800, 3600] {
        let prefs = Preferences {
            general: GeneralPreferences {
                auto_fetch_interval_secs: secs,
                ..GeneralPreferences::default()
            },
            ..Preferences::default()
        };
        save(dir.path(), &prefs).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(
            loaded.general.auto_fetch_interval_secs, secs,
            "interval {secs} did not round-trip"
        );
    }
}

#[test]
fn general_default_branch_name_custom_value_roundtrips() {
    // Cover the names users actually pick — yryvu's own deviation
    // (`main`), GK's (`master`), and a non-ASCII case to verify the
    // String field doesn't silently mangle UTF-8 on the wire.
    let dir = TempDir::new().unwrap();
    for name in ["main", "master", "trunk", "develop", "principal", "rama-ñ"] {
        let prefs = Preferences {
            general: GeneralPreferences {
                default_branch_name: name.to_string(),
                ..GeneralPreferences::default()
            },
            ..Preferences::default()
        };
        save(dir.path(), &prefs).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(
            loaded.general.default_branch_name, name,
            "branch name {name} did not round-trip"
        );
    }
}
