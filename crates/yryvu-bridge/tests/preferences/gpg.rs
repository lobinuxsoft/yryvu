// SPDX-License-Identifier: AGPL-3.0-or-later

//! GPG section tests (issue #104).

use tempfile::TempDir;
use yryvu_bridge::preferences::{file_path, load, save, GpgPreferences, Preferences};

#[test]
fn gpg_defaults_match_documented() {
    // Issue #104 — no signing key, no auto-sign. Users opt in.
    let g = Preferences::default().gpg;
    assert_eq!(g.signing_key_id, None);
    assert!(!g.sign_commits_by_default);
    assert!(!g.sign_tags_by_default);
    assert!(!g.ssh_signing_enabled);
}

#[test]
fn gpg_all_fields_set_roundtrip() {
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        gpg: GpgPreferences {
            signing_key_id: Some("ABCD1234EF567890".to_string()),
            sign_commits_by_default: true,
            sign_tags_by_default: true,
            ssh_signing_enabled: true,
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.gpg, prefs.gpg);
}

#[test]
fn gpg_serializes_as_camel_case() {
    // The IPC contract is camelCase. Drift on the multi-word fields
    // would silently break the panel reader.
    let prefs = Preferences {
        gpg: GpgPreferences {
            signing_key_id: Some("key".to_string()),
            sign_commits_by_default: true,
            sign_tags_by_default: true,
            ssh_signing_enabled: true,
        },
        ..Preferences::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    for key in [
        "\"gpg\"",
        "\"signingKeyId\"",
        "\"signCommitsByDefault\"",
        "\"signTagsByDefault\"",
        "\"sshSigningEnabled\"",
    ] {
        assert!(json.contains(key), "missing wire key {key} in {json}");
    }
}

#[test]
fn gpg_missing_section_falls_back_to_defaults() {
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.gpg, GpgPreferences::default());
}

#[test]
fn gpg_partial_section_fills_per_field_defaults() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "gpg": {"signCommitsByDefault": true}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert!(prefs.gpg.sign_commits_by_default);
    assert_eq!(prefs.gpg.signing_key_id, None);
    assert!(!prefs.gpg.sign_tags_by_default);
    assert!(!prefs.gpg.ssh_signing_enabled);
}
