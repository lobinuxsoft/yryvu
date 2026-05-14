// SPDX-License-Identifier: AGPL-3.0-or-later

//! Issue tracker section tests.

use tempfile::TempDir;
use yryvu_bridge::preferences::{file_path, load, save, IssueTrackerPreferences, Preferences};

#[test]
fn issue_tracker_defaults_match_documented() {
    // Issue #306. The global default pattern is `None` (no fallback);
    // linkify + auto-detect are both `true` so the feature is on by
    // default and resolves automatically for github / gitlab / etc.
    let it = Preferences::default().issue_tracker;
    assert_eq!(it.default_url_pattern, None);
    assert!(it.linkify_in_commits);
    assert!(it.auto_detect_provider);
}

#[test]
fn issue_tracker_all_fields_roundtrip() {
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        issue_tracker: IssueTrackerPreferences {
            default_url_pattern: Some("https://example.com/issues/{id}".to_string()),
            linkify_in_commits: false,
            auto_detect_provider: false,
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.issue_tracker, prefs.issue_tracker);
}

#[test]
fn issue_tracker_serializes_as_camel_case() {
    // The IPC contract is camelCase. Drift would silently break the
    // frontend reader — assert the exact wire keys the panel looks for.
    let prefs = Preferences::default();
    let json = serde_json::to_string(&prefs).unwrap();
    for key in [
        "\"issueTracker\"",
        "\"defaultUrlPattern\"",
        "\"linkifyInCommits\"",
        "\"autoDetectProvider\"",
    ] {
        assert!(json.contains(key), "missing wire key {key} in {json}");
    }
}

#[test]
fn issue_tracker_missing_section_falls_back_to_defaults() {
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.issue_tracker, IssueTrackerPreferences::default());
}

#[test]
fn issue_tracker_partial_section_fills_per_field_defaults() {
    // A user that overrode only the global default pattern should keep
    // the other two toggles on their documented defaults.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "issueTracker": {"defaultUrlPattern": "https://example.com/{id}"}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(
        prefs.issue_tracker.default_url_pattern.as_deref(),
        Some("https://example.com/{id}")
    );
    assert!(prefs.issue_tracker.linkify_in_commits);
    assert!(prefs.issue_tracker.auto_detect_provider);
}
