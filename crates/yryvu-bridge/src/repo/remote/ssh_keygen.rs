// SPDX-License-Identifier: AGPL-3.0-or-later

//! In-app SSH keypair generation + connection testing (#47).
//!
//! Keygen is pure Rust via the RustCrypto `ssh-key` crate — no
//! `ssh-keygen` shell-out (fragile PATH on Windows, interactive
//! passphrase prompts). The connection test DOES shell out to `ssh`
//! on purpose: git itself shells to the real `ssh`, so testing with
//! anything else would validate a library instead of the environment
//! (`~/.ssh/config`, agent, known_hosts) git will actually use.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::anyhow;
use serde::{Deserialize, Serialize};
use ssh_key::rand_core::OsRng;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};

use crate::backend::BackendError;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSshKeyRequest {
    /// `"ed25519"` (wizard default, instant) or `"rsa4096"` (slow in
    /// pure Rust — seconds; the UI shows a spinner).
    pub algorithm: String,
    /// Key comment, conventionally `user@host` or an email.
    pub comment: String,
    /// Empty = unencrypted private key. Non-empty encrypts with
    /// OpenSSH's bcrypt-pbkdf + aes256-ctr.
    pub passphrase: String,
    /// File stem under `~/.ssh`, e.g. `yryvu_github`.
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSshKey {
    /// OpenSSH one-liner (`ssh-ed25519 AAAA… comment`) ready to paste
    /// into the provider's SSH settings page.
    pub public_key: String,
    pub private_key_path: String,
    /// `SHA256:…` fingerprint of the public key.
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTestResult {
    pub authenticated: bool,
    /// Provider banner (e.g. GitHub's "Hi user! You've successfully
    /// authenticated…") or ssh's own error text.
    pub message: String,
}

/// Generate a keypair under `~/.ssh` with the private key written
/// `0600` (issue #47 acceptance). Returns the public one-liner +
/// fingerprint so the wizard can render the copy/upload step without
/// re-reading files.
pub fn generate_ssh_keypair(req: &GenerateSshKeyRequest) -> Result<GeneratedSshKey, BackendError> {
    let ssh_dir = default_ssh_dir()?;
    generate_into(&ssh_dir, req)
}

/// Test SSH authentication against `git@{host}` by shelling the real
/// `ssh -T`. Provider-agnostic success rule: ssh exits 255 only on its
/// own failure (auth, network) — any other exit code means the remote
/// command ran, i.e. authentication succeeded (GitHub returns 1 by
/// design, GitLab/Gitea/Bitbucket return 0).
pub fn test_ssh_connection(host: &str) -> Result<SshTestResult, BackendError> {
    validate_host(host)?;
    let out = Command::new("ssh")
        .args([
            "-T",
            // No interactive prompts: a passphrase-protected key that
            // isn't in the agent fails cleanly instead of hanging.
            "-o",
            "BatchMode=yes",
            // First contact with a host must not block on the
            // known_hosts prompt.
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ConnectTimeout=10",
            &format!("git@{host}"),
        ])
        .output()
        .map_err(|e| BackendError::Git(anyhow!("spawn ssh: {e}")))?;
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let message = if stderr.is_empty() { stdout } else { stderr };
    let authenticated = !matches!(out.status.code(), Some(255) | None);
    Ok(SshTestResult {
        authenticated,
        message,
    })
}

/// Load a private key into the running agent via `ssh-add`.
/// `SSH_ASKPASS_REQUIRE=never` keeps it non-interactive: a
/// passphrase-protected key fails fast with ssh-add's error instead
/// of hanging on a prompt — the wizard tells the user to `ssh-add`
/// manually in that case. yryvu never handles the passphrase itself.
pub fn add_key_to_agent(private_key_path: &Path) -> Result<(), BackendError> {
    let out = Command::new("ssh-add")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .arg(private_key_path)
        .output()
        .map_err(|e| BackendError::Git(anyhow!("spawn ssh-add: {e}")))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(BackendError::Git(anyhow!(
            "ssh-add failed: {}",
            stderr.trim()
        )));
    }
    Ok(())
}

/// Read the public half (`<private>.pub`) of a generated keypair so
/// the preferences panel can re-surface the copy-to-clipboard action
/// across sessions. Only the sibling `.pub` is ever read — the private
/// key never crosses the IPC boundary.
pub fn read_public_key(private_key_path: &Path) -> Result<String, BackendError> {
    let pub_path = private_key_path.with_extension("pub");
    fs::read_to_string(&pub_path)
        .map(|s| s.trim().to_string())
        .map_err(|e| BackendError::Git(anyhow!("read {}: {e}", pub_path.display())))
}

fn generate_into(
    ssh_dir: &Path,
    req: &GenerateSshKeyRequest,
) -> Result<GeneratedSshKey, BackendError> {
    let algorithm = match req.algorithm.as_str() {
        "ed25519" => Algorithm::Ed25519,
        // ssh-key's DEFAULT_RSA_KEY_SIZE is 4096.
        "rsa4096" => Algorithm::Rsa { hash: None },
        other => {
            return Err(BackendError::Git(anyhow!(
                "unsupported key algorithm '{other}'"
            )))
        }
    };
    let stem = validate_file_stem(&req.file_name)?;

    let mut key = PrivateKey::random(&mut OsRng, algorithm)
        .map_err(|e| BackendError::Git(anyhow!("generate key: {e}")))?;
    let comment = req.comment.trim();
    if !comment.is_empty() {
        key.set_comment(comment);
    }
    let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
    let public_key = key
        .public_key()
        .to_openssh()
        .map_err(|e| BackendError::Git(anyhow!("encode public key: {e}")))?;

    // Zeroizing<String> — wiped from memory on drop.
    let private_pem = if req.passphrase.is_empty() {
        key.to_openssh(LineEnding::LF)
    } else {
        key.encrypt(&mut OsRng, req.passphrase.as_bytes())
            .and_then(|enc| enc.to_openssh(LineEnding::LF))
    }
    .map_err(|e| BackendError::Git(anyhow!("encode private key: {e}")))?;

    fs::create_dir_all(ssh_dir)
        .map_err(|e| BackendError::Git(anyhow!("create {}: {e}", ssh_dir.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // ssh refuses world-readable key material; 0700 on the dir is
        // the conventional contract. Best effort — an existing dir
        // with custom perms is the user's call.
        let _ = fs::set_permissions(ssh_dir, fs::Permissions::from_mode(0o700));
    }

    let private_path = unique_key_path(ssh_dir, &stem);
    write_private(&private_path, private_pem.as_bytes())?;
    let pub_path = private_path.with_extension("pub");
    fs::write(&pub_path, format!("{public_key}\n"))
        .map_err(|e| BackendError::Git(anyhow!("write {}: {e}", pub_path.display())))?;

    Ok(GeneratedSshKey {
        public_key,
        private_key_path: private_path.display().to_string(),
        fingerprint,
    })
}

/// Create the private key file with `0600` from the first byte — the
/// mode rides the `create_new` open instead of a follow-up chmod so
/// there is no window where the key sits world-readable.
fn write_private(path: &Path, pem: &[u8]) -> Result<(), BackendError> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts
        .open(path)
        .map_err(|e| BackendError::Git(anyhow!("create {}: {e}", path.display())))?;
    file.write_all(pem)
        .and_then(|()| file.sync_all())
        .map_err(|e| BackendError::Git(anyhow!("write {}: {e}", path.display())))
}

/// `~/.ssh` for the real user home — keys must land where the `ssh`
/// binary looks, not in an app-config sandbox dir.
fn default_ssh_dir() -> Result<PathBuf, BackendError> {
    std::env::home_dir()
        .map(|home| home.join(".ssh"))
        .ok_or_else(|| BackendError::Git(anyhow!("cannot resolve the user home directory")))
}

/// File stems come from the renderer — constrain them to a flat,
/// portable charset so they cannot traverse out of `~/.ssh` or smuggle
/// option-looking names.
fn validate_file_stem(stem: &str) -> Result<String, BackendError> {
    let trimmed = stem.trim();
    let valid = !trimmed.is_empty()
        && !trimmed.starts_with(['-', '.'])
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if !valid {
        return Err(BackendError::Git(anyhow!(
            "invalid key file name '{stem}': use letters, digits, '_', '-', '.'"
        )));
    }
    Ok(trimmed.to_string())
}

/// `ssh` hostnames also come from the renderer and end up in an argv —
/// a value like `-oProxyCommand=…` would be parsed as an option.
fn validate_host(host: &str) -> Result<(), BackendError> {
    let valid = !host.is_empty()
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'));
    if !valid {
        return Err(BackendError::Git(anyhow!("invalid SSH host '{host}'")));
    }
    Ok(())
}

/// Never overwrite an existing key: suffix with the unix timestamp
/// (issue #47 names keys `yryvu_<host>_<timestamp>` on collision).
fn unique_key_path(ssh_dir: &Path, stem: &str) -> PathBuf {
    let bare = ssh_dir.join(stem);
    if !bare.exists() && !bare.with_extension("pub").exists() {
        return bare;
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    ssh_dir.join(format!("{stem}_{ts}"))
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn req(algorithm: &str, passphrase: &str) -> GenerateSshKeyRequest {
        GenerateSshKeyRequest {
            algorithm: algorithm.to_string(),
            comment: "tester@yryvu".to_string(),
            passphrase: passphrase.to_string(),
            file_name: "yryvu_test".to_string(),
        }
    }

    #[test]
    fn ed25519_keypair_written_with_0600_and_openssh_format() {
        let dir = TempDir::new().unwrap();
        let key = generate_into(dir.path(), &req("ed25519", "")).unwrap();

        assert!(key.public_key.starts_with("ssh-ed25519 "));
        assert!(key.public_key.ends_with("tester@yryvu"));
        assert!(key.fingerprint.starts_with("SHA256:"));

        let priv_path = PathBuf::from(&key.private_key_path);
        let pem = fs::read_to_string(&priv_path).unwrap();
        assert!(pem.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));
        assert!(priv_path.with_extension("pub").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&priv_path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn passphrase_encrypts_and_roundtrips() {
        let dir = TempDir::new().unwrap();
        let key = generate_into(dir.path(), &req("ed25519", "hunter2")).unwrap();

        let pem = fs::read_to_string(&key.private_key_path).unwrap();
        let parsed = PrivateKey::from_openssh(&pem).unwrap();
        assert!(parsed.is_encrypted());
        let decrypted = parsed.decrypt(b"hunter2").unwrap();
        assert_eq!(
            decrypted.fingerprint(HashAlg::Sha256).to_string(),
            key.fingerprint
        );
    }

    #[test]
    fn read_public_key_returns_the_pub_sibling() {
        let dir = TempDir::new().unwrap();
        let key = generate_into(dir.path(), &req("ed25519", "")).unwrap();
        let read = read_public_key(Path::new(&key.private_key_path)).unwrap();
        assert_eq!(read, key.public_key);
        // Missing sibling errors instead of panicking.
        assert!(read_public_key(Path::new("/nonexistent/key")).is_err());
    }

    #[test]
    fn collision_appends_timestamp_instead_of_overwriting() {
        let dir = TempDir::new().unwrap();
        let first = generate_into(dir.path(), &req("ed25519", "")).unwrap();
        let second = generate_into(dir.path(), &req("ed25519", "")).unwrap();
        assert_ne!(first.private_key_path, second.private_key_path);
        // The first key is intact.
        let pem = fs::read_to_string(&first.private_key_path).unwrap();
        assert!(pem.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));
    }

    #[test]
    fn file_stem_validation_blocks_traversal_and_options() {
        for bad in ["", "../evil", "a/b", "-flag", ".hidden", "a b"] {
            assert!(validate_file_stem(bad).is_err(), "accepted {bad:?}");
        }
        assert_eq!(
            validate_file_stem(" ok-name_1.key ").unwrap(),
            "ok-name_1.key"
        );
    }

    #[test]
    fn host_validation_blocks_argument_injection() {
        for bad in ["", "-oProxyCommand=evil", "host name", "host;rm"] {
            assert!(validate_host(bad).is_err(), "accepted {bad:?}");
        }
        assert!(validate_host("github.com").is_ok());
        assert!(validate_host("git.example-host.dev").is_ok());
    }

    #[test]
    fn unsupported_algorithm_is_rejected() {
        let dir = TempDir::new().unwrap();
        assert!(generate_into(dir.path(), &req("dsa", "")).is_err());
    }

    /// RSA-4096 keygen in pure Rust takes seconds in debug builds —
    /// excluded from the default test run; `cargo test -- --ignored`
    /// covers it before a release.
    #[test]
    #[ignore]
    fn rsa4096_keypair_generates() {
        let dir = TempDir::new().unwrap();
        let key = generate_into(dir.path(), &req("rsa4096", "")).unwrap();
        assert!(key.public_key.starts_with("ssh-rsa "));
    }
}
