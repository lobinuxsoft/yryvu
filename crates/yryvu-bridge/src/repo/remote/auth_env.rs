// SPDX-License-Identifier: AGPL-3.0-or-later

use std::process::Command;

use serde::Serialize;

/// Snapshot of the host's git credential environment.
///
/// Push / fetch / delete-remote rely on libgit2's credential callback
/// (`credentials.rs`) which silently tries SSH agent → credential helper
/// → default and only surfaces a generic error when all fail. This probe
/// runs the same checks *ahead of time* so the UI can tell the user
/// *which* method is missing and offer a setup path (#44).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthEnv {
    /// `SSH_AUTH_SOCK` is set — an ssh-agent is reachable.
    pub ssh_agent_socket: bool,
    /// Number of identities `ssh-add -l` reports loaded in the agent.
    /// Zero when the agent is empty, unreachable, or `ssh-add` is absent.
    pub ssh_keys_loaded: u32,
    /// Value of the global `credential.helper` git config, when set.
    pub credential_helper: Option<String>,
    /// Host operating system (`std::env::consts::OS`): `linux`, `macos`,
    /// `windows`, … Drives the OS-specific install hint in the wizard.
    pub host_os: String,
}

impl AuthEnv {
    /// True when at least one credential method is ready to authenticate
    /// a push. A reachable-but-empty ssh-agent does NOT count — an agent
    /// with no loaded keys cannot satisfy the SSH callback.
    pub fn has_usable(&self) -> bool {
        self.ssh_keys_loaded > 0 || self.credential_helper.is_some()
    }
}

/// Probe the current credential environment. Cheap enough to run on the
/// first auth-requiring failure; the frontend caches the result until the
/// next failure rather than polling.
pub fn detect() -> AuthEnv {
    AuthEnv {
        ssh_agent_socket: std::env::var_os("SSH_AUTH_SOCK").is_some(),
        ssh_keys_loaded: count_loaded_keys(&run_ssh_add_list()),
        credential_helper: read_credential_helper(),
        host_os: std::env::consts::OS.to_string(),
    }
}

/// Run `ssh-add -l`, returning its stdout. Empty string on any failure
/// (binary absent, agent unreachable) so `count_loaded_keys` reports 0.
fn run_ssh_add_list() -> String {
    Command::new("ssh-add")
        .arg("-l")
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default()
}

/// Count identities in `ssh-add -l` output. Each loaded key is one line
/// (`<bits> <fingerprint> <comment> (<type>)`). The "no identities"
/// sentinel produces zero. Kept pure so it is unit-testable without an
/// agent.
fn count_loaded_keys(output: &str) -> u32 {
    if output.contains("The agent has no identities") {
        return 0;
    }
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count() as u32
}

/// Read the global `credential.helper`. Returns `None` when unset or the
/// config is unreadable. Empty values (used to *disable* an inherited
/// helper) are treated as unset.
fn read_credential_helper() -> Option<String> {
    let cfg = git2::Config::open_default().ok()?;
    let helper = cfg.get_string("credential.helper").ok()?;
    let trimmed = helper.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_identities_sentinel_counts_zero() {
        assert_eq!(count_loaded_keys("The agent has no identities."), 0);
    }

    #[test]
    fn empty_output_counts_zero() {
        assert_eq!(count_loaded_keys(""), 0);
        assert_eq!(count_loaded_keys("\n  \n"), 0);
    }

    #[test]
    fn each_loaded_key_is_one_line() {
        let out = "2048 SHA256:abc user@host (RSA)\n256 SHA256:def laptop (ED25519)\n";
        assert_eq!(count_loaded_keys(out), 2);
    }

    #[test]
    fn has_usable_requires_loaded_key_or_helper() {
        let base = AuthEnv {
            ssh_agent_socket: true,
            ssh_keys_loaded: 0,
            credential_helper: None,
            host_os: "linux".to_string(),
        };
        // Reachable but empty agent + no helper → not usable.
        assert!(!base.has_usable());
        assert!(AuthEnv {
            ssh_keys_loaded: 1,
            ..base.clone()
        }
        .has_usable());
        assert!(AuthEnv {
            credential_helper: Some("store".to_string()),
            ..base
        }
        .has_usable());
    }
}
