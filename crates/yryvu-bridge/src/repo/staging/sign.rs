// SPDX-License-Identifier: AGPL-3.0-or-later

//! Commit signing — OpenPGP via `gpg` and SSH via `ssh-keygen -Y sign`.
//!
//! Mirrors GitKraken's shell-out strategy (audit
//! `docs/research/...sign...` + bundle strings `GPGPreferences-*`): we
//! never reimplement signing in-process. The git config is the source of
//! truth — `user.signingkey`, `gpg.format`, `gpg.program`,
//! `gpg.ssh.program` — and matches Git's own CLI semantics 1:1.
//!
//! Flow:
//!
//! 1. The caller builds the commit content with
//!    [`git2::Repository::commit_create_buffer`].
//! 2. We pipe those bytes through `gpg --status-fd=2 -bsau <key>` (or
//!    `ssh-keygen -Y sign -n git -f <key>`) and capture the armored
//!    signature on stdout.
//! 3. [`git2::Repository::commit_signed`] writes the new commit object
//!    with the signature embedded in the `gpgsig` header — readable by
//!    `git verify-commit` and `git log --show-signature`.
//!
//! The caller is responsible for updating `HEAD` to point at the new
//! Oid afterwards; `commit_signed` does *not* move the ref.
//!
//! BACKEND: git2 — shells out to gpg/ssh-keygen for the cryptographic
//! step. No pure-Rust crate replacement planned (sequoia-openpgp is
//! viable but reimplementing key + agent + passphrase prompting would
//! diverge from Git's own behavior, which is the exact reason GitKraken
//! also shells out).

use std::io::Write;
use std::process::{Command, Stdio};

use crate::backend::BackendError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignFormat {
    OpenPgp,
    Ssh,
}

/// Result of inspecting a repo's signing config. `None` for `key` means
/// `user.signingkey` is not set and signing cannot proceed. The struct
/// crosses the IPC boundary so the commit panel can disable the Sign
/// toggle (and surface a helpful hint) when no key is wired up.
/// `userName` / `userEmail` come from `user.name` / `user.email` in the
/// same config — the in-app key generator pre-fills its dialog from
/// them so the new GPG key matches the committer identity Git already
/// uses.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignConfig {
    pub format: SignFormat,
    pub key: Option<String>,
    pub program: String,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

pub fn load_config(repo: &git2::Repository) -> SignConfig {
    let cfg = repo.config().ok();
    let format = match cfg
        .as_ref()
        .and_then(|c| c.get_string("gpg.format").ok())
        .as_deref()
    {
        Some("ssh") => SignFormat::Ssh,
        Some("x509") => SignFormat::OpenPgp, // X.509 via gpgsm; we ignore the distinction
        _ => SignFormat::OpenPgp,
    };
    let key = cfg
        .as_ref()
        .and_then(|c| c.get_string("user.signingkey").ok())
        .filter(|s| !s.trim().is_empty());
    let program = cfg
        .as_ref()
        .and_then(|c| match format {
            SignFormat::OpenPgp => c.get_string("gpg.program").ok(),
            SignFormat::Ssh => c.get_string("gpg.ssh.program").ok(),
        })
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default_program(format).to_string());
    let user_name = cfg
        .as_ref()
        .and_then(|c| c.get_string("user.name").ok())
        .filter(|s| !s.trim().is_empty());
    let user_email = cfg
        .as_ref()
        .and_then(|c| c.get_string("user.email").ok())
        .filter(|s| !s.trim().is_empty());
    SignConfig {
        format,
        key,
        program,
        user_name,
        user_email,
    }
}

fn default_program(format: SignFormat) -> &'static str {
    match format {
        SignFormat::OpenPgp => "gpg",
        SignFormat::Ssh => "ssh-keygen",
    }
}

/// Inspect signing config from disk for a given path. Used by the
/// commit panel preflight (`commit_sign_config` IPC command).
pub fn inspect_config(repo_path: &std::path::Path) -> Result<SignConfig, BackendError> {
    let repo = super::super::common::open_git2(repo_path)?;
    Ok(load_config(&repo))
}

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
    let repo = super::super::common::open_git2(repo_path)?;
    let mut cfg = repo
        .config()
        .map_err(super::super::common::git2_err)?
        .open_level(git2::ConfigLevel::Local)
        .map_err(super::super::common::git2_err)?;
    cfg.set_str("user.signingkey", key)
        .map_err(super::super::common::git2_err)?;
    let fmt = match format {
        SignFormat::OpenPgp => "openpgp",
        SignFormat::Ssh => "ssh",
    };
    cfg.set_str("gpg.format", fmt)
        .map_err(super::super::common::git2_err)?;
    Ok(())
}

/// Sign `content` using the repo's configured signing tool. Returns the
/// armored signature ready to embed via `commit_signed`.
pub fn sign_bytes(repo: &git2::Repository, content: &[u8]) -> Result<String, BackendError> {
    let cfg = load_config(repo);
    let key = cfg.key.as_deref().ok_or_else(|| {
        sign_err("user.signingkey is not set; configure it in Git before signing")
    })?;
    let args = build_args(cfg.format, key);
    run_signer(&cfg.program, &args, content)
}

fn build_args(format: SignFormat, key: &str) -> Vec<String> {
    match format {
        SignFormat::OpenPgp => vec![
            "--status-fd=2".to_string(),
            "-bsau".to_string(),
            key.to_string(),
        ],
        SignFormat::Ssh => vec![
            "-Y".to_string(),
            "sign".to_string(),
            "-n".to_string(),
            "git".to_string(),
            "-f".to_string(),
            key.to_string(),
        ],
    }
}

fn run_signer(program: &str, args: &[String], stdin_bytes: &[u8]) -> Result<String, BackendError> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| sign_err(format!("failed to spawn '{program}': {e}")))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| sign_err("child stdin unavailable"))?;
        stdin
            .write_all(stdin_bytes)
            .map_err(|e| sign_err(format!("writing to '{program}' stdin: {e}")))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| sign_err(format!("waiting for '{program}': {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(sign_err(format!(
            "'{program}' exited with status {}: {}",
            output.status,
            stderr.trim()
        )));
    }

    let signature = String::from_utf8(output.stdout)
        .map_err(|e| sign_err(format!("signature is not valid UTF-8: {e}")))?;
    if signature.trim().is_empty() {
        return Err(sign_err("signer returned empty signature"));
    }
    Ok(signature)
}

fn sign_err<S: Into<String>>(msg: S) -> BackendError {
    BackendError::Git(anyhow::anyhow!("commit signing failed: {}", msg.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn init_repo() -> (TempDir, git2::Repository) {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Test").unwrap();
            cfg.set_str("user.email", "test@example.com").unwrap();
        }
        (dir, repo)
    }

    /// Generate an ed25519 SSH key (no passphrase) into the repo's
    /// workdir and return the absolute key path. Skips the test when
    /// `ssh-keygen` is unavailable so CI environments without it stay
    /// green.
    fn generate_ssh_key(repo_path: &Path) -> Option<std::path::PathBuf> {
        let key_path = repo_path.join("id_ed25519");
        let status = Command::new("ssh-keygen")
            .args([
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                "test",
                "-f",
                key_path.to_str().unwrap(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .ok()?;
        if !status.success() {
            return None;
        }
        Some(key_path)
    }

    #[test]
    fn load_config_returns_none_key_when_missing() {
        let (_dir, repo) = init_repo();
        let cfg = load_config(&repo);
        assert!(cfg.key.is_none());
        assert_eq!(cfg.format, SignFormat::OpenPgp);
        assert_eq!(cfg.program, "gpg");
    }

    #[test]
    fn load_config_picks_up_ssh_format_and_program() {
        let (_dir, repo) = init_repo();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("gpg.format", "ssh").unwrap();
            cfg.set_str("user.signingkey", "/tmp/dummy.pub").unwrap();
            cfg.set_str("gpg.ssh.program", "/custom/ssh-keygen")
                .unwrap();
        }
        let cfg = load_config(&repo);
        assert_eq!(cfg.format, SignFormat::Ssh);
        assert_eq!(cfg.key.as_deref(), Some("/tmp/dummy.pub"));
        assert_eq!(cfg.program, "/custom/ssh-keygen");
    }

    #[test]
    fn sign_bytes_errors_when_key_missing() {
        let (_dir, repo) = init_repo();
        let err = sign_bytes(&repo, b"hello").unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("user.signingkey"),
            "expected signingkey error, got: {msg}",
        );
    }

    #[test]
    fn ssh_signed_commit_verifies_via_git() {
        use super::super::commit::create_commit;
        use super::super::types::CommitOptions;

        let (dir, repo) = init_repo();
        let Some(key_path) = generate_ssh_key(dir.path()) else {
            eprintln!("ssh-keygen not available; skipping verify-commit roundtrip");
            return;
        };
        let pub_blob = fs::read_to_string(key_path.with_extension("pub")).unwrap();
        let allowed = dir.path().join("allowed_signers");
        fs::write(&allowed, format!("test@example.com {pub_blob}")).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("gpg.format", "ssh").unwrap();
            cfg.set_str("user.signingkey", key_path.to_str().unwrap())
                .unwrap();
            cfg.set_str("gpg.ssh.allowedSignersFile", allowed.to_str().unwrap())
                .unwrap();
        }
        // Stage a tracked file so the commit has a tree.
        fs::write(dir.path().join("a.txt"), "hello\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        drop(index);

        let sha = create_commit(
            dir.path(),
            &CommitOptions {
                summary: "signed".to_string(),
                gpg_sign: true,
                ..CommitOptions::default()
            },
        )
        .unwrap();
        assert_eq!(sha.len(), 40);

        // `git verify-commit` exit status must be zero.
        let status = Command::new("git")
            .args(["verify-commit", &sha])
            .current_dir(dir.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git available in $PATH");
        assert!(status.success(), "git verify-commit failed for {sha}");
    }

    #[test]
    fn ssh_sign_roundtrip_against_real_key() {
        let (dir, repo) = init_repo();
        let Some(key_path) = generate_ssh_key(dir.path()) else {
            eprintln!("ssh-keygen not available; skipping ssh sign roundtrip");
            return;
        };
        let pub_path = key_path.with_extension("pub");
        let pub_blob = fs::read_to_string(&pub_path).unwrap();

        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("gpg.format", "ssh").unwrap();
            cfg.set_str("user.signingkey", key_path.to_str().unwrap())
                .unwrap();
            let allowed = dir.path().join("allowed_signers");
            fs::write(&allowed, format!("test@example.com {pub_blob}")).unwrap();
            cfg.set_str("gpg.ssh.allowedSignersFile", allowed.to_str().unwrap())
                .unwrap();
        }

        let signature = sign_bytes(&repo, b"tree abc\n").unwrap();
        assert!(
            signature.contains("BEGIN SSH SIGNATURE"),
            "expected armored SSH signature, got: {signature}",
        );
        assert!(signature.contains("END SSH SIGNATURE"));
    }
}
