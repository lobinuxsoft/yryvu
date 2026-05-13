// SPDX-License-Identifier: AGPL-3.0-or-later

//! Commit section tests.

use tempfile::TempDir;
use yryvu_bridge::preferences::{file_path, load, save, CommitPreferences, Preferences};

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
