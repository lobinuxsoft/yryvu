// SPDX-License-Identifier: AGPL-3.0-or-later

//! In-app OpenPGP key generation — mirrors GitKraken's
//! `GPGPreferences-GpgGenerateKey` action (RSA 4096, 2-year expire,
//! name + email from the request). Shells out to `gpg --gen-key` with
//! a batch recipe and parses the `KEY_CREATED` status line.

use std::io::Write;
use std::process::{Command, Stdio};

use crate::backend::BackendError;

use super::sign_err;

/// Result of an in-app GPG key generation. Mirrors GitKraken's
/// `GPGPreferences-GpgGenerateKey` action — RSA 4096, 2-year expire,
/// name + email from the request. The caller (frontend) decides whether
/// to write the new fingerprint to `user.signingkey`; we don't touch
/// the repo config here so the same backend can serve the
/// "generate-from-preferences" flow that has no repo loaded.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedKey {
    pub key_id: String,
    pub fingerprint: String,
    pub public_key_armored: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyRequest {
    pub name: String,
    pub email: String,
    /// Empty string disables passphrase protection (`%no-protection`);
    /// non-empty string is fed through gpg's loopback pinentry. GK's
    /// equivalent surface doesn't ask for a passphrase at all — we
    /// expose the field so security-conscious users can opt in.
    #[serde(default)]
    pub passphrase: String,
}

pub fn generate_gpg_key(req: &GenerateKeyRequest) -> Result<GeneratedKey, BackendError> {
    let name = req.name.trim();
    let email = req.email.trim();
    if name.is_empty() || email.is_empty() {
        return Err(sign_err(
            "name and email are required (matches GitKraken's `Error-GpgKeyGenMissingNameOrEmail`)",
        ));
    }

    let mut recipe = String::new();
    recipe.push_str("Key-Type: RSA\n");
    recipe.push_str("Key-Length: 4096\n");
    recipe.push_str("Subkey-Type: RSA\n");
    recipe.push_str("Subkey-Length: 4096\n");
    recipe.push_str(&format!("Name-Real: {name}\n"));
    recipe.push_str(&format!("Name-Email: {email}\n"));
    recipe.push_str("Expire-Date: 2y\n");
    if req.passphrase.is_empty() {
        recipe.push_str("%no-protection\n");
    } else {
        recipe.push_str(&format!("Passphrase: {}\n", req.passphrase));
    }
    recipe.push_str("%commit\n");

    let mut args = vec!["--batch", "--status-fd=1", "--gen-key"];
    if !req.passphrase.is_empty() {
        args.insert(0, "--pinentry-mode=loopback");
    }
    let mut child = Command::new("gpg")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| sign_err(format!("failed to spawn 'gpg': {e}")))?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| sign_err("gpg stdin unavailable"))?;
        stdin
            .write_all(recipe.as_bytes())
            .map_err(|e| sign_err(format!("writing recipe to gpg: {e}")))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| sign_err(format!("waiting for gpg: {e}")))?;
    if !out.status.success() {
        return Err(sign_err(format!(
            "gpg --gen-key exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }

    // gpg emits `[GNUPG:] KEY_CREATED <P|S|B> <fingerprint>` on --status-fd.
    let stdout = String::from_utf8_lossy(&out.stdout);
    let fingerprint = stdout
        .lines()
        .find_map(|l| l.strip_prefix("[GNUPG:] KEY_CREATED ").map(str::trim))
        .and_then(|rest| rest.split_whitespace().nth(1))
        .ok_or_else(|| {
            sign_err(format!(
                "could not parse KEY_CREATED fingerprint from gpg output:\nstdout: {stdout}\nstderr: {}",
                String::from_utf8_lossy(&out.stderr)
            ))
        })?
        .to_string();
    let key_id = fingerprint
        .get(fingerprint.len().saturating_sub(16)..)
        .unwrap_or(&fingerprint)
        .to_string();

    // Export the armored public key for pasting into GitHub / GitLab.
    let armored = Command::new("gpg")
        .args(["--armor", "--export", &fingerprint])
        .output()
        .map_err(|e| sign_err(format!("failed to spawn 'gpg --export': {e}")))?;
    if !armored.status.success() {
        return Err(sign_err(format!(
            "gpg --export exited {}: {}",
            armored.status,
            String::from_utf8_lossy(&armored.stderr).trim()
        )));
    }
    let public_key_armored = String::from_utf8(armored.stdout)
        .map_err(|e| sign_err(format!("armored public key is not utf-8: {e}")))?;

    Ok(GeneratedKey {
        key_id,
        fingerprint,
        public_key_armored,
    })
}
