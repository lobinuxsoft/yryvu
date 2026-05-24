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
//!
//! Submodules:
//!
//! - [`config`] — `SignFormat`, `SignConfig`, `load_config`, `inspect_config`.
//! - [`keygen`] — `generate_gpg_key` (RSA 4096, batch recipe).
//! - [`keys`]   — `list_gpg_keys`, `export_gpg_public_key`, `set_signing_key`.
//! - [`exec`]   — `sign_bytes` (drives `gpg` / `ssh-keygen` for one commit).

mod config;
mod exec;
mod keygen;
mod keys;

pub use config::{inspect_config, load_config, SignConfig, SignFormat};
pub use exec::sign_bytes;
pub use keygen::{generate_gpg_key, GenerateKeyRequest, GeneratedKey};
pub use keys::{export_gpg_public_key, list_gpg_keys, set_signing_key, GpgKeyInfo};

use crate::backend::BackendError;

fn sign_err<S: Into<String>>(msg: S) -> BackendError {
    BackendError::Git(anyhow::anyhow!("commit signing failed: {}", msg.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::{Command, Stdio};
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
