// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tools / external-terminal section tests.

use tempfile::TempDir;
use yryvu_bridge::preferences::{
    file_path, load, save, ExternalTerminal, Preferences, ToolPreferences,
};

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
