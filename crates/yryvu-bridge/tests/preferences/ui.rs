// SPDX-License-Identifier: AGPL-3.0-or-later

//! UI section tests — theme / density / zoom / tooltips / animations.

use tempfile::TempDir;
use yryvu_bridge::preferences::{
    file_path, load, save, AnimationMode, Density, Preferences, UiPreferences,
};

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
