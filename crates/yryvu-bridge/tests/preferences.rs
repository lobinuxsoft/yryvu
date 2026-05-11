// SPDX-License-Identifier: AGPL-3.0-or-later

//! Integration tests for `yryvu_bridge::preferences`. Cover the contract
//! the IPC layer relies on: missing file → defaults, roundtrip, partial
//! JSON loads via `#[serde(default)]`, unknown-field tolerance, and
//! version-newer rejection.

use tempfile::TempDir;
use yryvu_bridge::preferences::{
    file_path, load, reset, save, AnimationMode, CommitPreferences, Density, ExternalTerminal,
    GeneralPreferences, PermanentTabState, PermanentTabs, Preferences, PreferencesError, Tab,
    TabsPreferences, ToolPreferences, UiPreferences,
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
fn ui_theme_defaults_to_a_yryvu() {
    // #322: flagship default. `auto` is opt-in via the dropdown, not the
    // baseline. New installs land on the Yryvu plumage palette.
    let prefs = Preferences::default();
    assert_eq!(prefs.ui.theme, "a-yryvu");
}

#[test]
fn ui_theme_missing_field_falls_back_to_default() {
    // A preferences file written before #322 lacked an explicit theme
    // value; loading must fill it with `"a-yryvu"` instead of failing.
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1, "ui": {}}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.ui.theme, "a-yryvu");
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
fn ui_zoom_defaults_to_one() {
    let prefs = Preferences::default();
    assert_eq!(prefs.ui.zoom, 1.0);
}

#[test]
fn ui_zoom_custom_value_roundtrips() {
    // Walk the whole GK ladder to catch any rename / camelCase drift on
    // every supported value, not just the default.
    let dir = TempDir::new().unwrap();
    for zoom in [0.8_f32, 0.9, 1.0, 1.1, 1.2, 1.3] {
        let prefs = Preferences {
            ui: UiPreferences {
                zoom,
                ..UiPreferences::default()
            },
            ..Preferences::default()
        };
        save(dir.path(), &prefs).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(
            loaded.ui.zoom, zoom,
            "ladder value {zoom} did not round-trip"
        );
    }
}

#[test]
fn ui_zoom_serializes_as_camel_case_number() {
    // The IPC contract is a JSON number under the literal key `zoom`.
    // Both the Preferences panel and the status-bar mirror (#313) read
    // this exact field — drift breaks both surfaces silently.
    let prefs = Preferences {
        ui: UiPreferences {
            zoom: 1.1,
            ..UiPreferences::default()
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    assert!(json.contains("\"zoom\":1.1"), "got {json}");
}

#[test]
fn ui_zoom_missing_field_falls_back_to_default() {
    // A preferences file written before #293 lacks `zoom`. Loading must
    // fill it with 1.0 instead of failing.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "ui": {"theme": "auto"}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.ui.zoom, 1.0);
}

#[test]
fn ui_tooltips_enabled_defaults_to_true() {
    let prefs = Preferences::default();
    assert!(prefs.ui.tooltips_enabled);
}

#[test]
fn ui_tooltips_enabled_disabled_roundtrips() {
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        ui: UiPreferences {
            tooltips_enabled: false,
            ..UiPreferences::default()
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert!(!loaded.ui.tooltips_enabled);
}

#[test]
fn ui_tooltips_enabled_serializes_as_camel_case() {
    // Frontend reads `tooltipsEnabled` literal — drift breaks the
    // <Tooltip> wrapper's gate silently when sub-PR #316 lands.
    let prefs = Preferences {
        ui: UiPreferences {
            tooltips_enabled: false,
            ..UiPreferences::default()
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    assert!(json.contains("\"tooltipsEnabled\":false"), "got {json}");
}

#[test]
fn ui_tooltips_enabled_missing_field_falls_back_to_default() {
    // A preferences file written before #315 lacks `tooltipsEnabled`.
    // Loading must fill it with `true` instead of failing.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "ui": {"theme": "auto"}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert!(prefs.ui.tooltips_enabled);
}

#[test]
fn ui_tooltip_delay_ms_defaults_to_500() {
    let prefs = Preferences::default();
    assert_eq!(prefs.ui.tooltip_delay_ms, 500);
}

#[test]
fn ui_tooltip_delay_ms_custom_value_roundtrips() {
    // Walk the panel-gated range plus the boundaries to catch any rename
    // / camelCase drift on every value the UI is allowed to produce.
    let dir = TempDir::new().unwrap();
    for delay in [0_u16, 100, 500, 1000, 2000] {
        let prefs = Preferences {
            ui: UiPreferences {
                tooltip_delay_ms: delay,
                ..UiPreferences::default()
            },
            ..Preferences::default()
        };
        save(dir.path(), &prefs).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(
            loaded.ui.tooltip_delay_ms, delay,
            "delay {delay} did not round-trip"
        );
    }
}

#[test]
fn ui_tooltip_delay_ms_serializes_as_camel_case_number() {
    // The IPC contract is a JSON number under `tooltipDelayMs` — frontend
    // (sub-PR #316) reads it directly to drive the show-after timer.
    let prefs = Preferences {
        ui: UiPreferences {
            tooltip_delay_ms: 250,
            ..UiPreferences::default()
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    assert!(json.contains("\"tooltipDelayMs\":250"), "got {json}");
}

#[test]
fn ui_tooltip_delay_ms_missing_field_falls_back_to_default() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "ui": {"theme": "auto"}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.ui.tooltip_delay_ms, 500);
}

#[test]
fn ui_animations_defaults_to_system() {
    let prefs = Preferences::default();
    assert_eq!(prefs.ui.animations, AnimationMode::System);
}

#[test]
fn ui_animations_custom_value_roundtrips() {
    let dir = TempDir::new().unwrap();
    for mode in [
        AnimationMode::Always,
        AnimationMode::System,
        AnimationMode::Never,
    ] {
        let prefs = Preferences {
            ui: UiPreferences {
                animations: mode,
                ..UiPreferences::default()
            },
            ..Preferences::default()
        };
        save(dir.path(), &prefs).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(
            loaded.ui.animations, mode,
            "animation mode {mode:?} did not round-trip"
        );
    }
}

#[test]
fn ui_animations_serializes_as_camel_case() {
    // Frontend (sub-PR #316) reads the literal strings to drive the
    // `data-animations` root attribute. Drift would silently flip the
    // CSS override block off without breaking the load path.
    for (mode, literal) in [
        (AnimationMode::Always, "\"animations\":\"always\""),
        (AnimationMode::System, "\"animations\":\"system\""),
        (AnimationMode::Never, "\"animations\":\"never\""),
    ] {
        let prefs = Preferences {
            ui: UiPreferences {
                animations: mode,
                ..UiPreferences::default()
            },
            ..Preferences::default()
        };
        let json = serde_json::to_string(&prefs).unwrap();
        assert!(json.contains(literal), "got {json}");
    }
}

#[test]
fn ui_animations_missing_field_falls_back_to_default() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "ui": {"theme": "auto"}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.ui.animations, AnimationMode::System);
}

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

#[test]
fn tabs_partial_load_falls_back_to_section_defaults() {
    // A file written by an older yryvu won't have the `tabs` section.
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

#[test]
fn commit_defaults_match_documented() {
    // Issue #304 — pin every default in one place so a drift in the
    // sub-struct's Default impl shows up immediately, not when a user
    // notices their commit panel behaves differently post-upgrade.
    let c = Preferences::default().commit;
    assert_eq!(c.commit_template, None);
    assert!(!c.use_template_for_commit_messages);
    assert!(!c.default_push_after_commit);
    assert!(!c.default_skip_git_hooks);
    assert!(c.remove_comments_from_commit_messages);
}

#[test]
fn commit_all_fields_flipped_roundtrip() {
    // Flip every bool away from its default and pick a non-default
    // template, then roundtrip. Catches any rename or missing serde
    // attribute on the way to disk.
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        commit: CommitPreferences {
            commit_template: Some("Summary line\n\nLonger description.".to_string()),
            use_template_for_commit_messages: true,
            default_push_after_commit: true,
            default_skip_git_hooks: true,
            remove_comments_from_commit_messages: false,
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.commit, prefs.commit);
}

#[test]
fn commit_serializes_as_camel_case() {
    // The IPC contract is camelCase. Drift on any of the multi-word
    // fields would silently break the frontend reader — assert the
    // exact wire keys the panel (wave 2) will look for.
    let prefs = Preferences {
        commit: CommitPreferences {
            commit_template: Some("hello".to_string()),
            use_template_for_commit_messages: true,
            ..CommitPreferences::default()
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    for key in [
        "\"commitTemplate\"",
        "\"useTemplateForCommitMessages\"",
        "\"defaultPushAfterCommit\"",
        "\"defaultSkipGitHooks\"",
        "\"removeCommentsFromCommitMessages\"",
    ] {
        assert!(json.contains(key), "missing wire key {key} in {json}");
    }
}

#[test]
fn commit_template_utf8_roundtrips() {
    // The template is free-form user text and must survive non-ASCII
    // bytes — accents, emoji, newlines — without mangling. Catches any
    // codepath that re-encodes through a lossy intermediate.
    let dir = TempDir::new().unwrap();
    let template = "Resumen 🐦\n\nDescripción con acentos: ñ á é í ó ú.";
    let prefs = Preferences {
        commit: CommitPreferences {
            commit_template: Some(template.to_string()),
            use_template_for_commit_messages: true,
            ..CommitPreferences::default()
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.commit.commit_template.as_deref(), Some(template));
}

#[test]
fn commit_missing_section_falls_back_to_defaults() {
    // A preferences file written before #304 lacks the `commit` section
    // entirely. Loading must fill it with the documented defaults
    // instead of failing — same contract as the existing partial-JSON
    // tests, exercised against the newly added section.
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.commit, CommitPreferences::default());
}

#[test]
fn commit_partial_section_fills_per_field_defaults() {
    // Per-field `#[serde(default)]` means a section with only some keys
    // present must fill the missing ones individually, not reject. A
    // user that toggled only `defaultPushAfterCommit` should not lose
    // the rest of the section on next load.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "commit": {"defaultPushAfterCommit": true}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert!(prefs.commit.default_push_after_commit);
    assert_eq!(prefs.commit.commit_template, None);
    assert!(prefs.commit.remove_comments_from_commit_messages);
    assert!(!prefs.commit.default_skip_git_hooks);
}

#[test]
fn tools_defaults_match_documented() {
    // Issue #105 — both `path` and `args` are `None` out of the box.
    // yryvu has no way to guess the user's preferred terminal across
    // Linux desktops / macOS / Windows, so the launcher errors out
    // with `NotConfigured` until the user picks one explicitly.
    let t = Preferences::default().tools;
    assert_eq!(t.external_terminal.path, None);
    assert_eq!(t.external_terminal.args, None);
}

#[test]
fn tools_all_fields_set_roundtrip() {
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        tools: ToolPreferences {
            external_terminal: ExternalTerminal {
                path: Some("/usr/bin/gnome-terminal".to_string()),
                args: Some("--working-directory={cwd}".to_string()),
            },
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.tools, prefs.tools);
}

#[test]
fn tools_serializes_as_camel_case() {
    // The IPC contract is camelCase. The frontend (wave 2) reads the
    // literal wire keys to drive the External Terminal panel rows.
    let prefs = Preferences {
        tools: ToolPreferences {
            external_terminal: ExternalTerminal {
                path: Some("/usr/bin/kitty".to_string()),
                args: Some("--directory {cwd}".to_string()),
            },
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    assert!(json.contains("\"tools\""), "got {json}");
    assert!(json.contains("\"externalTerminal\""), "got {json}");
    assert!(json.contains("\"path\":\"/usr/bin/kitty\""), "got {json}");
    assert!(
        json.contains("\"args\":\"--directory {cwd}\""),
        "got {json}"
    );
}

#[test]
fn tools_missing_section_falls_back_to_defaults() {
    // A preferences file written before #105 lacks the `tools` section
    // entirely. Loading must fill it with the documented defaults
    // instead of failing — same contract as the per-section fallback
    // tests for the prior sections.
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.tools, ToolPreferences::default());
}

#[test]
fn tools_partial_section_fills_per_field_defaults() {
    // Per-field `#[serde(default)]` on `ExternalTerminal` means a user
    // who set only `path` keeps `args` defaulted to `None` instead of
    // losing the section on next load.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "tools": {"externalTerminal": {"path": "/usr/bin/alacritty"}}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(
        prefs.tools.external_terminal.path.as_deref(),
        Some("/usr/bin/alacritty")
    );
    assert_eq!(prefs.tools.external_terminal.args, None);
}
