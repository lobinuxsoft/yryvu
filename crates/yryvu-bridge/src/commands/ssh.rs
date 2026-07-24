// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::{Path, PathBuf};

use crate::repo::remote::ssh_keygen::{
    self, GenerateSshKeyRequest, GeneratedSshKey, SshTestResult,
};

/// Generate an SSH keypair under `~/.ssh` for the guided credential
/// flow (#47). Blocking thread: RSA-4096 keygen in pure Rust takes
/// seconds and must not pin an async worker.
#[tauri::command]
pub async fn generate_ssh_key(req: GenerateSshKeyRequest) -> Result<GeneratedSshKey, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh_keygen::generate_ssh_keypair(&req).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Run `ssh -T git@{host}` to verify the installed key authenticates.
/// `private_key_path` pins the test to one identity — without it a
/// custom-named key outside the agent false-negatives. Network
/// round-trip with a 10s connect timeout — blocking thread.
#[tauri::command]
pub async fn test_ssh_connection(
    host: String,
    private_key_path: Option<String>,
) -> Result<SshTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh_keygen::test_ssh_connection(&host, private_key_path.as_deref().map(Path::new))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Append a Host block (IdentityFile + AddKeysToAgent) to
/// `~/.ssh/config` so the OpenSSH stack finds the generated key.
/// Returns false when the host is already configured (user's config
/// wins).
#[tauri::command]
pub async fn ensure_ssh_config_entry(
    host: String,
    private_key_path: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh_keygen::ensure_ssh_config_entry(&host, &PathBuf::from(&private_key_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Load the generated private key into the running ssh-agent.
/// Non-interactive: passphrase-protected keys fail fast with ssh-add's
/// error so the UI can route the user to a manual `ssh-add`.
#[tauri::command]
pub async fn add_ssh_key_to_agent(private_key_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh_keygen::add_key_to_agent(&PathBuf::from(&private_key_path)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read the `.pub` sibling of a generated private key for the
/// preferences panel's copy action.
#[tauri::command]
pub async fn read_ssh_public_key(private_key_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh_keygen::read_public_key(&PathBuf::from(&private_key_path)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deliver the user's answer to a Trust-On-First-Use prompt (#508). A
/// fetch/push blocked on an unknown SSH host is waiting on this; `accept`
/// unblocks it (the key is then appended to `known_hosts`), `false`
/// aborts the operation. Fire-and-forget — an unknown or stale session
/// id is a no-op. Not spawn_blocking: it only signals a channel.
#[tauri::command]
pub fn ssh_tofu_resolve(session_id: String, accept: bool) {
    crate::repo::remote::tofu::resolve(&session_id, accept);
}
