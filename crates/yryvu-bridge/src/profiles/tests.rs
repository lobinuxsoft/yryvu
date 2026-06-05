// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use git2::{Repository, RepositoryInitOptions};
use tempfile::tempdir;

use super::*;

fn profile(id: &str, name: &str, binding: Binding) -> Profile {
    Profile {
        id: id.to_string(),
        display_name: name.to_string(),
        author_name: name.to_string(),
        author_email: format!("{name}@example.com"),
        avatar: None,
        signing_key: None,
        default_branch: None,
        binding,
    }
}

fn init_repo(path: &Path, origin: Option<&str>) -> Repository {
    let mut opts = RepositoryInitOptions::new();
    opts.initial_head("main");
    let repo = Repository::init_opts(path, &opts).unwrap();
    if let Some(url) = origin {
        repo.remote("origin", url).unwrap();
    }
    repo
}

#[test]
fn store_roundtrip_preserves_everything() {
    let dir = tempdir().unwrap();
    let mut store = ProfilesStore::default();
    upsert(
        &mut store,
        profile("a", "Work", Binding::Account("github".into())),
    );
    upsert(&mut store, profile("b", "Personal", Binding::Local));
    store.default_profile_id = Some("b".into());
    store.repo_overrides.insert("/some/repo".into(), "a".into());

    save(dir.path(), &store).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded, store);
}

#[test]
fn load_missing_file_is_default() {
    let dir = tempdir().unwrap();
    assert_eq!(load(dir.path()).unwrap(), ProfilesStore::default());
}

#[test]
fn upsert_replaces_same_id() {
    let mut store = ProfilesStore::default();
    upsert(&mut store, profile("a", "Old", Binding::Local));
    upsert(&mut store, profile("a", "New", Binding::Local));
    assert_eq!(store.profiles.len(), 1);
    assert_eq!(store.profiles[0].display_name, "New");
}

#[test]
fn delete_scrubs_overrides_and_default() {
    let mut store = ProfilesStore::default();
    upsert(&mut store, profile("a", "Work", Binding::Local));
    store.default_profile_id = Some("a".into());
    store.repo_overrides.insert("/repo".into(), "a".into());

    delete(&mut store, "a");
    assert!(store.profiles.is_empty());
    assert!(store.repo_overrides.is_empty());
    assert_eq!(store.default_profile_id, None);
}

#[test]
fn resolve_manual_override_wins_over_remote() {
    let dir = tempdir().unwrap();
    init_repo(dir.path(), Some("https://github.com/foo/bar.git"));
    let mut store = ProfilesStore::default();
    upsert(
        &mut store,
        profile("gh", "GH", Binding::Account("github".into())),
    );
    upsert(&mut store, profile("loc", "Local", Binding::Local));
    set_repo_override(&mut store, dir.path(), Some("loc".into()));

    assert_eq!(resolve(&store, dir.path()).unwrap().id, "loc");
}

#[test]
fn resolve_matches_remote_account() {
    let dir = tempdir().unwrap();
    init_repo(dir.path(), Some("git@gitlab.com:foo/bar.git"));
    let mut store = ProfilesStore::default();
    upsert(
        &mut store,
        profile("gh", "GH", Binding::Account("github".into())),
    );
    upsert(
        &mut store,
        profile("gl", "GL", Binding::Account("gitlab".into())),
    );
    upsert(&mut store, profile("loc", "Local", Binding::Local));

    assert_eq!(resolve(&store, dir.path()).unwrap().id, "gl");
}

#[test]
fn resolve_falls_back_to_local_for_unknown_remote() {
    let dir = tempdir().unwrap();
    init_repo(dir.path(), None);
    let mut store = ProfilesStore::default();
    upsert(
        &mut store,
        profile("gh", "GH", Binding::Account("github".into())),
    );
    upsert(&mut store, profile("loc", "Local", Binding::Local));

    assert_eq!(resolve(&store, dir.path()).unwrap().id, "loc");
}

#[test]
fn resolve_honours_explicit_default_over_first_local() {
    let dir = tempdir().unwrap();
    init_repo(dir.path(), None);
    let mut store = ProfilesStore::default();
    upsert(&mut store, profile("l1", "First", Binding::Local));
    upsert(&mut store, profile("l2", "Second", Binding::Local));
    store.default_profile_id = Some("l2".into());

    assert_eq!(resolve(&store, dir.path()).unwrap().id, "l2");
}

#[test]
fn resolve_empty_store_is_none() {
    let dir = tempdir().unwrap();
    init_repo(dir.path(), None);
    assert!(resolve(&ProfilesStore::default(), dir.path()).is_none());
}

#[test]
fn clearing_override_restores_auto_resolution() {
    let dir = tempdir().unwrap();
    init_repo(dir.path(), Some("https://github.com/foo/bar.git"));
    let mut store = ProfilesStore::default();
    upsert(
        &mut store,
        profile("gh", "GH", Binding::Account("github".into())),
    );
    upsert(&mut store, profile("loc", "Local", Binding::Local));
    set_repo_override(&mut store, dir.path(), Some("loc".into()));
    set_repo_override(&mut store, dir.path(), None);

    assert_eq!(resolve(&store, dir.path()).unwrap().id, "gh");
}

#[test]
fn identity_blank_is_none() {
    let mut p = profile("a", "X", Binding::Local);
    p.author_name = "  ".into();
    assert!(p.identity().is_none());
    p.author_name = "Real".into();
    p.author_email = "".into();
    assert!(p.identity().is_none());
}
