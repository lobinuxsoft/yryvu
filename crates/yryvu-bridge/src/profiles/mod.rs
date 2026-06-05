// SPDX-License-Identifier: AGPL-3.0-or-later

//! User profile management.
//!
//! A *profile* bundles a commit identity (author name/email), an optional
//! avatar, signing key, and default branch preference. Unlike GitKraken —
//! which lets the user flip the active profile from a toolbar switcher and
//! optionally syncs it into the global `.gitconfig` — yryvu resolves the
//! active profile *per repo* and applies its identity **in memory** at
//! commit time. The user's `.gitconfig` is never touched.
//!
//! # Resolution order (see [`resolve`])
//!
//! 1. **Manual override** — the user pinned a profile to this repo.
//! 2. **Remote account** — `origin`'s host classifies to a provider
//!    ([`detect_hosting_service`]); the profile bound to that provider wins.
//! 3. **Local fallback** — the explicit default, else the first `Local`
//!    profile, else the first profile of any kind.
//!
//! Profile IDs are generated frontend-side (a UUID) so this layer stays
//! free of randomness and is fully deterministic under test. Duplicate is
//! likewise a frontend clone-with-new-id then [`upsert`].
//!
//! # Persistence
//!
//! The store is a single JSON document under the platform config dir,
//! written `tmp + fsync + rename` for crash safety — the same scheme as
//! [`crate::preferences`].

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::repo::hosting::{detect_hosting_service, HostingService};

const SCHEMA_VERSION: u32 = 1;
const FILE_NAME: &str = "profiles.json";

/// How a profile is bound to repositories. Drives auto-resolution.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", tag = "kind", content = "service")]
pub enum Binding {
    /// Auto-selected when a repo's `origin` classifies to this provider
    /// (`"github"` / `"gitlab"` / `"gitea"` / `"bitbucket"`).
    Account(String),
    /// Machine-local identity used for repos with no recognised remote.
    #[default]
    Local,
}

/// A commit identity + presentation bundle. `id` is assigned by the
/// frontend (UUID) and is the stable key for overrides and defaults.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    /// Human label shown in the switcher (e.g. "Work", "Personal").
    pub display_name: String,
    /// `user.name` applied to commits resolved to this profile.
    pub author_name: String,
    /// `user.email` applied to commits resolved to this profile.
    pub author_email: String,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub signing_key: Option<String>,
    #[serde(default)]
    pub default_branch: Option<String>,
    #[serde(default)]
    pub binding: Binding,
}

impl Profile {
    /// The commit identity, or `None` when name/email are blank (the
    /// commit path then falls back to git config).
    pub fn identity(&self) -> Option<(&str, &str)> {
        let name = self.author_name.trim();
        let email = self.author_email.trim();
        (!name.is_empty() && !email.is_empty()).then_some((name, email))
    }
}

/// The persisted profile document.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesStore {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub profiles: Vec<Profile>,
    /// Manual per-repo pin: canonical repo path → profile id. Overrides
    /// auto-resolution. Cleared when the referenced profile is deleted.
    #[serde(default)]
    pub repo_overrides: BTreeMap<String, String>,
    /// Fallback profile id when no remote matches and no override is set.
    #[serde(default)]
    pub default_profile_id: Option<String>,
}

impl Default for ProfilesStore {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            profiles: Vec::new(),
            repo_overrides: BTreeMap::new(),
            default_profile_id: None,
        }
    }
}

fn default_version() -> u32 {
    SCHEMA_VERSION
}

#[derive(Debug, Error)]
pub enum ProfilesError {
    #[error("profiles I/O failed at {path}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("profiles parse failed at {path}")]
    Parse {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("profiles schema version {got} is newer than supported (max {max})")]
    UnsupportedVersion { got: u32, max: u32 },
}

/// Absolute path of the profiles file in `dir`.
pub fn file_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Load the store from `<dir>/profiles.json`, or a default on first run.
pub fn load(dir: &Path) -> Result<ProfilesStore, ProfilesError> {
    let path = file_path(dir);
    if !path.exists() {
        return Ok(ProfilesStore::default());
    }
    let bytes = fs::read(&path).map_err(|e| ProfilesError::Io {
        path: path.display().to_string(),
        source: e,
    })?;
    let store: ProfilesStore =
        serde_json::from_slice(&bytes).map_err(|e| ProfilesError::Parse {
            path: path.display().to_string(),
            source: e,
        })?;
    if store.version > SCHEMA_VERSION {
        return Err(ProfilesError::UnsupportedVersion {
            got: store.version,
            max: SCHEMA_VERSION,
        });
    }
    Ok(store)
}

/// Persist the store atomically (`tmp + fsync + rename`).
pub fn save(dir: &Path, store: &ProfilesStore) -> Result<(), ProfilesError> {
    fs::create_dir_all(dir).map_err(|e| ProfilesError::Io {
        path: dir.display().to_string(),
        source: e,
    })?;
    let final_path = file_path(dir);
    let tmp_path = final_path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(store).map_err(|e| ProfilesError::Parse {
        path: final_path.display().to_string(),
        source: e,
    })?;
    {
        let mut tmp = fs::File::create(&tmp_path).map_err(|e| ProfilesError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
        tmp.write_all(&json).map_err(|e| ProfilesError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
        tmp.sync_all().map_err(|e| ProfilesError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
    }
    fs::rename(&tmp_path, &final_path).map_err(|e| ProfilesError::Io {
        path: final_path.display().to_string(),
        source: e,
    })
}

/// Insert a new profile or replace the existing one with the same `id`.
pub fn upsert(store: &mut ProfilesStore, profile: Profile) {
    match store.profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(slot) => *slot = profile,
        None => store.profiles.push(profile),
    }
}

/// Remove a profile and scrub every reference to it (overrides + default).
pub fn delete(store: &mut ProfilesStore, id: &str) {
    store.profiles.retain(|p| p.id != id);
    store.repo_overrides.retain(|_, pid| pid != id);
    if store.default_profile_id.as_deref() == Some(id) {
        store.default_profile_id = None;
    }
}

/// Pin `profile_id` to `repo_path`, or clear the pin when `None`.
pub fn set_repo_override(store: &mut ProfilesStore, repo_path: &Path, profile_id: Option<String>) {
    let key = canonical_key(repo_path);
    match profile_id {
        Some(id) => {
            store.repo_overrides.insert(key, id);
        }
        None => {
            store.repo_overrides.remove(&key);
        }
    }
}

/// Resolve the active profile for `repo_path`: override → remote account →
/// local fallback. Returns `None` only when the store has no profiles.
pub fn resolve<'a>(store: &'a ProfilesStore, repo_path: &Path) -> Option<&'a Profile> {
    if let Some(id) = store.repo_overrides.get(&canonical_key(repo_path)) {
        if let Some(found) = store.profiles.iter().find(|p| &p.id == id) {
            return Some(found);
        }
    }
    let service = detect_hosting_service(repo_path);
    if service != HostingService::Unknown {
        let svc = service.as_str();
        if let Some(found) = store
            .profiles
            .iter()
            .find(|p| matches!(&p.binding, Binding::Account(s) if s == svc))
        {
            return Some(found);
        }
    }
    local_default(store)
}

/// The fallback profile: explicit default, else first `Local`, else any.
fn local_default(store: &ProfilesStore) -> Option<&Profile> {
    if let Some(id) = &store.default_profile_id {
        if let Some(found) = store.profiles.iter().find(|p| &p.id == id) {
            return Some(found);
        }
    }
    store
        .profiles
        .iter()
        .find(|p| matches!(p.binding, Binding::Local))
        .or_else(|| store.profiles.first())
}

/// Normalise a repo path for use as an override key. Canonicalises when
/// the path exists so symlinked / relative spellings collapse; otherwise
/// falls back to the lossy display form.
fn canonical_key(repo_path: &Path) -> String {
    fs::canonicalize(repo_path)
        .unwrap_or_else(|_| repo_path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}
