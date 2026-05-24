// SPDX-License-Identifier: AGPL-3.0-or-later

//! OpenPGP secret-key enumeration, public-key export, and writing the
//! resulting selector into the repo's `user.signingkey`. Mirrors GK's
//! GPG preferences panel surface (Current Key dropdown + Copy public
//! key + Set as signing key).

use std::process::Command;

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2};

use super::{sign_err, SignFormat};

/// Minimal info for an existing OpenPGP secret key surfaced by `gpg
/// --list-secret-keys`. Mirrors the columns GitKraken's "Current Key"
/// dropdown shows: long key id, fingerprint, primary UID (name +
/// email). Used by the GPG preferences panel so users don't have to
/// hand-type fingerprints.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpgKeyInfo {
    pub key_id: String,
    pub fingerprint: String,
    pub uid: String,
}

/// Enumerate the OpenPGP secret keys in the user's gpg keyring via
/// `gpg --list-secret-keys --with-colons`. Returns an empty Vec when
/// gpg is missing or has no keys — UI treats that as "offer Generate".
pub fn list_gpg_keys() -> Result<Vec<GpgKeyInfo>, BackendError> {
    let out = Command::new("gpg")
        .args(["--list-secret-keys", "--with-colons", "--fixed-list-mode"])
        .output()
        .map_err(|e| sign_err(format!("failed to spawn 'gpg': {e}")))?;
    if !out.status.success() {
        // `gpg` returns non-zero on an empty keyring on some versions;
        // treat that as "no keys" rather than a hard error.
        return Ok(Vec::new());
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut keys = Vec::new();
    let mut current: Option<(String, String, String)> = None; // (long_keyid, fingerprint, uid)
    for line in text.lines() {
        // Colon-format spec: https://git.gnupg.org/cgi-bin/gitweb.cgi?p=gnupg.git;a=blob;f=doc/DETAILS
        let fields: Vec<&str> = line.split(':').collect();
        match fields.first().copied() {
            Some("sec") => {
                // Flush previous if complete; start a new record.
                if let Some((kid, fpr, uid)) = current.take() {
                    if !fpr.is_empty() && !uid.is_empty() {
                        keys.push(GpgKeyInfo {
                            key_id: kid,
                            fingerprint: fpr,
                            uid,
                        });
                    }
                }
                let kid = fields.get(4).copied().unwrap_or("").to_string();
                current = Some((kid, String::new(), String::new()));
            }
            Some("fpr") => {
                if let Some((_, ref mut fpr, _)) = current.as_mut() {
                    if fpr.is_empty() {
                        *fpr = fields.get(9).copied().unwrap_or("").to_string();
                    }
                }
            }
            Some("uid") => {
                if let Some((_, _, ref mut uid)) = current.as_mut() {
                    if uid.is_empty() {
                        *uid = fields.get(9).copied().unwrap_or("").to_string();
                    }
                }
            }
            _ => {}
        }
    }
    if let Some((kid, fpr, uid)) = current {
        if !fpr.is_empty() && !uid.is_empty() {
            keys.push(GpgKeyInfo {
                key_id: kid,
                fingerprint: fpr,
                uid,
            });
        }
    }
    Ok(keys)
}

/// Export an OpenPGP public key as armored text. Accepts any selector
/// `gpg --export` understands — fingerprint, long key id, short key id,
/// or `user@example.com` (matches GitKraken's "Copy public key" surface
/// in the GPG preferences panel).
pub fn export_gpg_public_key(selector: &str) -> Result<String, BackendError> {
    let selector = selector.trim();
    if selector.is_empty() {
        return Err(sign_err("no key identifier provided"));
    }
    let out = Command::new("gpg")
        .args(["--armor", "--export", selector])
        .output()
        .map_err(|e| sign_err(format!("failed to spawn 'gpg --export': {e}")))?;
    if !out.status.success() {
        return Err(sign_err(format!(
            "gpg --export exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    let armored = String::from_utf8(out.stdout)
        .map_err(|e| sign_err(format!("armored public key is not utf-8: {e}")))?;
    if armored.trim().is_empty() {
        return Err(sign_err(format!(
            "gpg has no public key for '{selector}' — generate or import one first"
        )));
    }
    Ok(armored)
}

/// Write `user.signingkey` (and optionally `gpg.format`) into the repo's
/// local git config. Called after a successful in-app key generation so
/// the next commit picks the new key up automatically. The frontend
/// passes `format = "openpgp"` for GPG keys; SSH key generation would
/// set `"ssh"` (not wired here yet — SSH keys are usually generated by
/// `ssh-keygen` outside this flow).
pub fn set_signing_key(
    repo_path: &std::path::Path,
    key: &str,
    format: SignFormat,
) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let mut cfg = repo
        .config()
        .map_err(git2_err)?
        .open_level(git2::ConfigLevel::Local)
        .map_err(git2_err)?;
    cfg.set_str("user.signingkey", key).map_err(git2_err)?;
    let fmt = match format {
        SignFormat::OpenPgp => "openpgp",
        SignFormat::Ssh => "ssh",
    };
    cfg.set_str("gpg.format", fmt).map_err(git2_err)?;
    Ok(())
}
