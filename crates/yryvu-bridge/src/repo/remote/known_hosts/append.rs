// SPDX-License-Identifier: AGPL-3.0-or-later

//! Appending a newly-trusted host key to the user's
//! `~/.ssh/known_hosts`, in OpenSSH format.

use std::io::Write as _;
use std::path::Path;

use super::parse::user_known_host_location;

/// Append a trusted host key to the user's `~/.ssh/known_hosts`. Called
/// only after the user has confirmed a `HostKeyVerdict::Unknown` prompt
/// against the shown fingerprint.
///
/// Creates `~/.ssh` (0700) and the file (0600) if missing. The key is
/// written verbatim from what was verified, so the next connection
/// matches the exact bytes the user approved — no re-fetch that a MITM
/// could answer differently.
pub fn append_trusted_host(host: &str, key_type: &str, key_b64: &str) -> Result<(), String> {
    let path = user_known_host_location()
        .ok_or_else(|| "cannot resolve home directory for known_hosts".to_string())?;
    append_host_line(&path, host, key_type, key_b64)
}

/// Append one OpenSSH-format entry to `path`, creating the `.ssh`
/// directory (0700) and the file (0600) as needed. Split from
/// [`append_trusted_host`] so the write logic is testable without
/// mutating `HOME`.
fn append_host_line(path: &Path, host: &str, key_type: &str, key_b64: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        set_permissions(parent, 0o700);
    }

    // Avoid gluing our line onto a file whose last line has no newline.
    let needs_newline = std::fs::metadata(path)
        .map(|m| m.len() > 0)
        .unwrap_or(false)
        && !ends_with_newline(path);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    set_permissions(path, 0o600);

    let prefix = if needs_newline { "\n" } else { "" };
    file.write_all(format!("{prefix}{host} {key_type} {key_b64}\n").as_bytes())
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(())
}

fn ends_with_newline(path: &Path) -> bool {
    std::fs::read(path)
        .ok()
        .and_then(|b| b.last().copied())
        .map(|b| b == b'\n')
        .unwrap_or(true)
}

#[cfg(unix)]
fn set_permissions(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt as _;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn set_permissions(_path: &Path, _mode: u32) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_host_line_writes_openssh_format() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".ssh").join("known_hosts");
        append_host_line(
            &path,
            "fresh.example.com",
            "ssh-ed25519",
            "AAAAC3NzaC1lZDI1NTE5AAAAIAWkjI6XT2SZh3xNk5NhisA3o3sGzWR+VAKMSqHtI0aY",
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "fresh.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAWkjI6XT2SZh3xNk5NhisA3o3sGzWR+VAKMSqHtI0aY\n"
        );
    }

    /// A file whose last line lacks a trailing newline must not get the
    /// new entry glued onto it.
    #[test]
    fn append_host_line_inserts_separator_when_missing_newline() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("known_hosts");
        std::fs::write(&path, "existing.example.com ssh-rsa AAAA").unwrap();
        append_host_line(&path, "new.example.com", "ssh-ed25519", "BBBB").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "existing.example.com ssh-rsa AAAA\nnew.example.com ssh-ed25519 BBBB\n"
        );
    }
}
