// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tabs section tests.

use tempfile::TempDir;
use yryvu_bridge::preferences::{
    file_path, load, save, PermanentTabState, PermanentTabs, Preferences, Tab, TabsPreferences,
};

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
