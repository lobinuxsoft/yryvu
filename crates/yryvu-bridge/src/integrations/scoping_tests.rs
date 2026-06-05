// SPDX-License-Identifier: AGPL-3.0-or-later

//! Profile-scoping tests that don't touch the OS keyring. Token I/O
//! (`get_integration` / `save_integration`) hits libsecret/Keychain and
//! isn't exercised in CI; here we cover the deterministic, keyring-free
//! surface: account namespacing, sidecar v2 entry selection, the
//! consumption-vs-panel split in `list_configured`, and v1→v2 load
//! compatibility.

use std::collections::HashMap;

use tempfile::tempdir;

use super::types::{IntegrationEntry, SIDECAR_VERSION};
use super::{account, list_configured, read_sidecar, write_sidecar, IntegrationsConfig};

fn entry(configured: bool) -> IntegrationEntry {
    IntegrationEntry {
        configured,
        hostname: None,
    }
}

fn profile_map(pairs: &[(&str, bool)]) -> HashMap<String, IntegrationEntry> {
    pairs
        .iter()
        .map(|(k, c)| (k.to_string(), entry(*c)))
        .collect()
}

#[test]
fn account_namespacing() {
    assert_eq!(account(Some("p1"), "github"), "p1:github");
    assert_eq!(account(None, "github"), "github");
}

#[test]
fn list_configured_scoped_is_profile_only() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("integrations.json");
    let mut cfg = IntegrationsConfig::default();
    cfg.profiles
        .insert("p1".into(), profile_map(&[("github", true)]));
    cfg.profiles
        .insert("p2".into(), profile_map(&[("gitlab", true)]));
    cfg.integrations.insert("gitea".into(), entry(true)); // legacy
    write_sidecar(&path, &cfg).unwrap();

    assert_eq!(list_configured(&path, Some("p1")).unwrap(), vec!["github"]);
    assert_eq!(list_configured(&path, Some("p2")).unwrap(), vec!["gitlab"]);
    assert!(list_configured(&path, Some("nope")).unwrap().is_empty());
}

#[test]
fn list_configured_none_is_union_sorted() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("integrations.json");
    let mut cfg = IntegrationsConfig::default();
    cfg.profiles
        .insert("p1".into(), profile_map(&[("github", true)]));
    cfg.integrations.insert("gitea".into(), entry(true));
    write_sidecar(&path, &cfg).unwrap();

    // Union of legacy + every profile, deduped + sorted.
    assert_eq!(
        list_configured(&path, None).unwrap(),
        vec!["gitea".to_string(), "github".to_string()]
    );
}

#[test]
fn list_configured_skips_unconfigured() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("integrations.json");
    let mut cfg = IntegrationsConfig::default();
    cfg.profiles
        .insert("p1".into(), profile_map(&[("github", false)]));
    write_sidecar(&path, &cfg).unwrap();

    assert!(list_configured(&path, Some("p1")).unwrap().is_empty());
    assert!(list_configured(&path, None).unwrap().is_empty());
}

#[test]
fn v2_sidecar_roundtrips_profiles() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("integrations.json");
    let mut cfg = IntegrationsConfig::default();
    cfg.profiles
        .insert("p1".into(), profile_map(&[("github", true)]));
    write_sidecar(&path, &cfg).unwrap();

    let back = read_sidecar(&path).unwrap();
    assert_eq!(back.version, SIDECAR_VERSION);
    assert!(back.profiles["p1"]["github"].configured);
}

#[test]
fn v1_file_loads_into_v2_struct() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("integrations.json");
    // A pre-scoping (v1) file: flat `integrations`, no `profiles`.
    std::fs::write(
        &path,
        br#"{"version":1,"integrations":{"github":{"configured":true}}}"#,
    )
    .unwrap();

    let cfg = read_sidecar(&path).unwrap();
    assert!(cfg.profiles.is_empty());
    assert!(cfg.integrations["github"].configured);
    // The legacy entry is visible to consumption (`None`) lookups so
    // pre-v2 tokens keep working.
    assert_eq!(list_configured(&path, None).unwrap(), vec!["github"]);
    // ...but not attributed to any specific profile.
    assert!(list_configured(&path, Some("p1")).unwrap().is_empty());
}
