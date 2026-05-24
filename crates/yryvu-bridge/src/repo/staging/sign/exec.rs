// SPDX-License-Identifier: AGPL-3.0-or-later

//! Cryptographic step — pipes commit content through `gpg -bsau <key>`
//! or `ssh-keygen -Y sign -n git -f <key>` and captures the armored
//! signature on stdout. Driven by the repo's git config (`gpg.format`,
//! `user.signingkey`, `gpg.program` / `gpg.ssh.program`).

use std::io::Write;
use std::process::{Command, Stdio};

use crate::backend::BackendError;

use super::{load_config, sign_err, SignFormat};

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
