// SPDX-License-Identifier: AGPL-3.0-or-later

//! Notifications section tests.

use tempfile::TempDir;
use yryvu_bridge::preferences::{file_path, load, save, NotificationsPreferences, Preferences};

#[test]
fn notifications_defaults_match_documented() {
    // Issue #193 — yryvu deviation: every category defaults to ON.
    // Notifications are enabled out of the box; the panel offers
    // per-category opt-out for users who find specific categories
    // noisy.
    let n = Preferences::default().notifications;
    assert!(n.remote_sync_notifications);
    assert!(n.branch_notifications);
    assert!(n.commit_notifications);
    assert!(n.stash_notifications);
    assert!(n.repo_object_notifications);
    assert!(n.undo_redo_notifications);
}

#[test]
fn notifications_all_fields_flipped_roundtrip() {
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        notifications: NotificationsPreferences {
            remote_sync_notifications: false,
            branch_notifications: false,
            commit_notifications: false,
            stash_notifications: false,
            repo_object_notifications: false,
            undo_redo_notifications: false,
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.notifications, prefs.notifications);
}

#[test]
fn notifications_serializes_as_camel_case() {
    // The IPC contract is camelCase. Drift on any of the multi-word
    // category keys would silently break the wave-2 consumer that
    // reads them in the `notify.*` API path.
    let prefs = Preferences::default();
    let json = serde_json::to_string(&prefs).unwrap();
    for key in [
        "\"remoteSyncNotifications\"",
        "\"branchNotifications\"",
        "\"commitNotifications\"",
        "\"stashNotifications\"",
        "\"repoObjectNotifications\"",
        "\"undoRedoNotifications\"",
    ] {
        assert!(json.contains(key), "missing wire key {key} in {json}");
    }
}

#[test]
fn notifications_missing_section_falls_back_to_defaults() {
    // A preferences file written before #193 lacks the `notifications`
    // section entirely. Loading must fill it with the documented
    // defaults instead of failing.
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.notifications, NotificationsPreferences::default());
}

#[test]
fn notifications_partial_section_fills_per_field_defaults() {
    // Per-field `#[serde(default)]` means a section with only some
    // keys present must fill the missing ones individually, not
    // reject. A user that muted only `stashNotifications` should not
    // lose the rest of the section on next load.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "notifications": {"stashNotifications": false}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert!(!prefs.notifications.stash_notifications);
    assert!(prefs.notifications.remote_sync_notifications);
    assert!(prefs.notifications.branch_notifications);
    assert!(prefs.notifications.commit_notifications);
    assert!(prefs.notifications.repo_object_notifications);
    assert!(prefs.notifications.undo_redo_notifications);
}
