// SPDX-License-Identifier: AGPL-3.0-or-later

//! Sidecar JSON config for non-secret integration metadata —
//! `configured` flags + per-self-hosted hostnames. Tokens live in the
//! OS keyring, NOT here.
//!
//! Atomic write pattern (matches chajá's existing convention from
//! `undo_log` / `preferences`): create_dir_all → tmp file → write_all
//! → sync_all → rename. Crash-safe; readers either see the old file
//! or the new file, never half a file.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::types::{IntegrationEntry, SIDECAR_VERSION};

/// On-disk shape. The `version` field gates load-time migrations;
/// loaders refuse versions newer than [`SIDECAR_VERSION`] so a
/// downgrade can't silently drop fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    /// Legacy v1 global entries (`type → entry`). Read-only fallback —
    /// new writes go to [`Self::profiles`]. Preserved across writes so
    /// pre-v2 tokens keep resolving.
    #[serde(default)]
    pub integrations: HashMap<String, IntegrationEntry>,
    /// v2 profile-scoped entries: `profile_id → type → entry`.
    #[serde(default)]
    pub profiles: HashMap<String, HashMap<String, IntegrationEntry>>,
}

fn default_version() -> u32 {
    SIDECAR_VERSION
}

impl Default for IntegrationsConfig {
    fn default() -> Self {
        Self {
            version: SIDECAR_VERSION,
            integrations: HashMap::new(),
            profiles: HashMap::new(),
        }
    }
}

/// Read the sidecar from `path`. Missing file → empty config (returns
/// default). Bad JSON or unsupported version → typed error.
pub fn read(path: &Path) -> Result<IntegrationsConfig, BackendError> {
    if !path.exists() {
        return Ok(IntegrationsConfig::default());
    }
    let bytes = fs::read(path).map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    let cfg: IntegrationsConfig =
        serde_json::from_slice(&bytes).map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    if cfg.version > SIDECAR_VERSION {
        return Err(BackendError::UnsupportedSidecarVersion {
            found: cfg.version,
            supported: SIDECAR_VERSION,
        });
    }
    Ok(cfg)
}

/// Atomically write `cfg` to `path` mode 0600 (best-effort on
/// platforms that have unix permissions). Pattern: create_dir_all
/// parent → tmp file beside target → write_all → sync_all → rename.
pub fn write(path: &Path, cfg: &IntegrationsConfig) -> Result<(), BackendError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes =
        serde_json::to_vec_pretty(cfg).map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    {
        let mut f = File::create(&tmp).map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
        f.write_all(&bytes)
            .map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
        f.sync_all()
            .map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    }
    set_mode_0600_best_effort(&tmp);
    fs::rename(&tmp, path).map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    Ok(())
}

#[cfg(unix)]
fn set_mode_0600_best_effort(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        perms.set_mode(0o600);
        let _ = fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn set_mode_0600_best_effort(_path: &Path) {
    // Windows ACLs are out of scope for the Linux-primary chajá v1.
    // The Credential Vault path stores the actual secret; sidecar
    // hostnames aren't secret enough to warrant the extra plumbing.
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trip_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("integrations.json");
        let cfg = IntegrationsConfig::default();
        write(&path, &cfg).unwrap();
        let read_back = read(&path).unwrap();
        assert_eq!(read_back.version, SIDECAR_VERSION);
        assert!(read_back.integrations.is_empty());
    }

    #[test]
    fn missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("integrations.json");
        let cfg = read(&path).unwrap();
        assert_eq!(cfg.version, SIDECAR_VERSION);
    }

    #[test]
    fn unsupported_version_rejected() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("integrations.json");
        fs::write(&path, br#"{"version": 999, "integrations": {}}"#).unwrap();
        match read(&path) {
            Err(BackendError::UnsupportedSidecarVersion { found, supported }) => {
                assert_eq!(found, 999);
                assert_eq!(supported, SIDECAR_VERSION);
            }
            other => panic!("expected UnsupportedSidecarVersion, got {other:?}"),
        }
    }

    #[test]
    fn round_trip_with_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("integrations.json");
        let mut cfg = IntegrationsConfig::default();
        cfg.integrations.insert(
            "github".to_string(),
            IntegrationEntry {
                configured: true,
                hostname: None,
            },
        );
        cfg.integrations.insert(
            "githubEnterprise".to_string(),
            IntegrationEntry {
                configured: true,
                hostname: Some("https://ghe.example.com".to_string()),
            },
        );
        write(&path, &cfg).unwrap();
        let read_back = read(&path).unwrap();
        assert_eq!(read_back.integrations.len(), 2);
        assert_eq!(
            read_back.integrations["githubEnterprise"]
                .hostname
                .as_deref(),
            Some("https://ghe.example.com")
        );
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_lands_at_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let path = dir.path().join("integrations.json");
        write(&path, &IntegrationsConfig::default()).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
