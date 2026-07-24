// SPDX-License-Identifier: AGPL-3.0-or-later

//! OpenSSH `known_hosts` verification for the git2 `certificate_check`
//! callback (#508).
//!
//! ## Why this exists
//!
//! git2-rs drops libgit2's `valid` bit (`remote_callbacks.rs`, the C
//! `valid` param is bound to `_valid`), so a registered
//! `certificate_check` cannot learn whether libgit2's own known_hosts
//! check passed. To tell a **new host** (prompt, Trust-On-First-Use)
//! apart from a **changed key** (reject — possible MITM) we must
//! re-check `known_hosts` ourselves. Hand-rolling that parse (hashed
//! `|1|` HMAC-SHA1 entries, `@revoked`, `@cert-authority`, glob and
//! negated host patterns) is exactly where a subtle bug turns TOFU into
//! blind-accept, so the decision core here is ported verbatim from
//! Cargo's `src/sources/git/known_hosts.rs` (MIT/Apache), including its
//! test suite. The only edits strip Cargo's config system: yryvu reads
//! OpenSSH files from disk and the bundled keys, nothing else.
//!
//! ## Limitations (same as Cargo)
//!
//! Reads OpenSSH `known_hosts` from the well-known locations only. Does
//! not honour `~/.ssh/config` directives that move those files
//! (`UserKnownHostsFile`, `GlobalKnownHostsFile`, `KnownHostsCommand`),
//! nor `CheckHostIP` / `VerifyHostKeyDNS`. The port passed to the
//! callback is unavailable, so a `[host]:port` entry for a non-22 remote
//! is treated as a new host (re-prompt) rather than matched.

use std::fmt::{self, Display};
use std::io::Write as _;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine as _;
use git2::cert::{CertHostkey, SshHostKeyType};
use hmac::Mac as _;
use sha2::{Digest as _, Sha256};

/// Host keys hard-coded for convenience, sourced from
/// <https://api.github.com/meta>. Ignored for a host the user has their
/// own entry for, so they can always override (useful if a key is
/// rotated). Ported from Cargo.
static BUNDLED_KEYS: &[(&str, &str, &str)] = &[
    (
        "github.com",
        "ssh-ed25519",
        "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
    ),
    (
        "github.com",
        "ecdsa-sha2-nistp256",
        "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=",
    ),
    (
        "github.com",
        "ssh-rsa",
        "AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=",
    ),
];

/// Keys public hosts have rotated away from. Distrusted explicitly:
/// there is no other way to distribute revocations of SSH host keys, so
/// a user still holding the old key locally would be vulnerable to a
/// MITM with access to the old key. Unlike [`BUNDLED_KEYS`], these are
/// not overridable — we *know* they are bad. Ported from Cargo.
static BUNDLED_REVOCATIONS: &[(&str, &str, &str)] = &[
    // Used until March 24, 2023: https://github.blog/2023-03-23-we-updated-our-rsa-ssh-host-key/
    (
        "github.com",
        "ssh-rsa",
        "AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==",
    ),
];

/// The outcome of verifying a remote host key against `known_hosts`.
///
/// This is the security contract the TOFU layer acts on: only
/// [`Trusted`](HostKeyVerdict::Trusted) may proceed silently, only
/// [`Unknown`](HostKeyVerdict::Unknown) may prompt, and every other
/// variant is a hard reject that must never degrade into a prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyVerdict {
    /// Host and key matched a known entry (file or bundled). Accept.
    Trusted,
    /// No entry matched the hostname — a first contact. The only variant
    /// eligible for a TOFU prompt; on confirm, append this exact key.
    Unknown {
        host: String,
        /// OpenSSH key-type token, e.g. `ssh-ed25519` — the second field
        /// of the `known_hosts` line to append.
        key_type: String,
        /// Base64 of the raw host-key blob — the third field to append.
        key_b64: String,
        /// `SHA256:<base64-nopad>`, shown to the user for out-of-band
        /// validation. The same string OpenSSH prints.
        fingerprint: String,
    },
    /// The hostname matched but the key differs. Possible MITM — reject,
    /// never prompt.
    Changed {
        host: String,
        fingerprint: String,
        /// Where the conflicting key was found, for the error message.
        old_location: String,
    },
    /// Matched a `@revoked` entry (or a bundled revocation) — reject.
    Revoked { host: String, location: String },
    /// Matched only a `@cert-authority` marker, which is unsupported —
    /// reject rather than silently ignore (a CA-only host we can't
    /// validate is not a host we trust).
    CertAuthorityOnly { host: String, location: String },
    /// The remote host key could not be read from the certificate.
    Unavailable,
}

/// Verify a remote SSH host key against the on-disk `known_hosts` files
/// plus the bundled keys/revocations.
pub fn verify(cert_host_key: &CertHostkey<'_>, host: &str) -> HostKeyVerdict {
    let Some(remote_host_key) = cert_host_key.hostkey() else {
        return HostKeyVerdict::Unavailable;
    };
    let Some(remote_key_type) = cert_host_key.hostkey_type() else {
        return HostKeyVerdict::Unavailable;
    };

    let mut known_hosts = Vec::new();
    for path in known_host_files() {
        if !path.exists() {
            continue;
        }
        match load_hostfile(&path) {
            Ok(hosts) => known_hosts.extend(hosts),
            Err(e) => tracing::warn!("failed to read known_hosts {}: {e}", path.display()),
        }
    }
    load_bundled(&mut known_hosts);

    match check_ssh_known_hosts_loaded(&known_hosts, host, remote_key_type, remote_host_key) {
        Ok(()) => HostKeyVerdict::Trusted,
        Err(KnownHostError::HostKeyNotFound {
            hostname,
            key_type,
            remote_host_key,
            remote_fingerprint,
            ..
        }) => HostKeyVerdict::Unknown {
            host: hostname,
            key_type: key_type.name().to_string(),
            key_b64: remote_host_key,
            fingerprint: format!("SHA256:{remote_fingerprint}"),
        },
        Err(KnownHostError::HostKeyHasChanged {
            hostname,
            old_known_host,
            remote_fingerprint,
            ..
        }) => HostKeyVerdict::Changed {
            host: hostname,
            fingerprint: format!("SHA256:{remote_fingerprint}"),
            old_location: old_known_host.location.to_string(),
        },
        Err(KnownHostError::HostKeyRevoked {
            hostname, location, ..
        }) => HostKeyVerdict::Revoked {
            host: hostname,
            location: location.to_string(),
        },
        Err(KnownHostError::HostHasOnlyCertAuthority { hostname, location }) => {
            HostKeyVerdict::CertAuthorityOnly {
                host: hostname,
                location: location.to_string(),
            }
        }
    }
}

/// Append a trusted host key to the user's `~/.ssh/known_hosts`, in
/// OpenSSH format. Called only after the user has confirmed a
/// [`HostKeyVerdict::Unknown`] prompt against the shown fingerprint.
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

/// Populate the bundled keys and revocations. Bundled keys are skipped
/// for hosts the user already configured (override path); revocations
/// are always added.
fn load_bundled(known_hosts: &mut Vec<KnownHost>) {
    use std::collections::HashSet;
    let configured_hosts: HashSet<String> = known_hosts
        .iter()
        .flat_map(|kh| kh.patterns.split(',').map(|p| p.to_lowercase()))
        .collect();
    for (patterns, key_type, key) in BUNDLED_KEYS {
        if !configured_hosts.contains(*patterns) {
            let Ok(key) = STANDARD.decode(key) else {
                continue;
            };
            known_hosts.push(KnownHost {
                location: KnownHostLocation::Bundled,
                patterns: patterns.to_string(),
                key_type: key_type.to_string(),
                key,
                line_type: KnownHostLineType::Key,
            });
        }
    }
    for (patterns, key_type, key) in BUNDLED_REVOCATIONS {
        let Ok(key) = STANDARD.decode(key) else {
            continue;
        };
        known_hosts.push(KnownHost {
            location: KnownHostLocation::Bundled,
            patterns: patterns.to_string(),
            key_type: key_type.to_string(),
            key,
            line_type: KnownHostLineType::Revoked,
        });
    }
}

// ---------------------------------------------------------------------
// Decision core — ported verbatim from Cargo's known_hosts.rs. Do not
// "clean up": every branch here is load-bearing security logic.
// ---------------------------------------------------------------------

// Variant names kept as ported from Cargo, hence the shared `Host` prefix.
#[allow(clippy::enum_variant_names)]
enum KnownHostError {
    /// The host key was not found.
    HostKeyNotFound {
        hostname: String,
        key_type: SshHostKeyType,
        remote_host_key: String,
        remote_fingerprint: String,
        #[allow(dead_code)]
        other_hosts: Vec<KnownHost>,
    },
    /// The host key was found, but does not match the remote's key.
    HostKeyHasChanged {
        hostname: String,
        #[allow(dead_code)]
        key_type: SshHostKeyType,
        old_known_host: KnownHost,
        #[allow(dead_code)]
        remote_host_key: String,
        remote_fingerprint: String,
    },
    /// The host key was found with a @revoked marker; it must not be accepted.
    HostKeyRevoked {
        hostname: String,
        #[allow(dead_code)]
        key_type: SshHostKeyType,
        #[allow(dead_code)]
        remote_host_key: String,
        location: KnownHostLocation,
    },
    /// The host key was not found, but a matching known host had a
    /// @cert-authority marker (unsupported).
    HostHasOnlyCertAuthority {
        hostname: String,
        location: KnownHostLocation,
    },
}

/// The location where a host key was found.
#[derive(Clone)]
enum KnownHostLocation {
    File { path: PathBuf, lineno: u32 },
    Bundled,
}

impl Display for KnownHostLocation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KnownHostLocation::File { path, lineno } => {
                write!(f, "{} line {lineno}", path.display())
            }
            KnownHostLocation::Bundled => f.write_str("bundled with yryvu"),
        }
    }
}

/// Checks a host key against a loaded set of known hosts.
// The error enum is large (it carries the conflicting key for the
// message), but this runs once per host verification, never in a hot
// path, and boxing would distort the verbatim port from Cargo.
#[allow(clippy::result_large_err)]
fn check_ssh_known_hosts_loaded(
    known_hosts: &[KnownHost],
    host: &str,
    remote_key_type: SshHostKeyType,
    remote_host_key: &[u8],
) -> Result<(), KnownHostError> {
    // Tracks a potential error returned only if no matching key is found.
    let mut latent_errors: Vec<KnownHostError> = Vec::new();

    // Entries with an identical key but a different hostname.
    let mut other_hosts = Vec::new();

    // Whether we found a matching line we would accept. We can't return
    // immediately — a later @revoked line for the same key must win.
    let mut accepted_known_host_found = false;

    // Older OpenSSH (before 6.8) showed MD5; we only support SHA256.
    let remote_fingerprint = STANDARD_NO_PAD.encode(Sha256::digest(remote_host_key));
    let remote_host_key_encoded = STANDARD.encode(remote_host_key);

    for known_host in known_hosts {
        // The key type from libgit2 must match the host file's.
        if known_host.key_type != remote_key_type.name() {
            continue;
        }
        let key_matches = known_host.key == remote_host_key;
        if !known_host.host_matches(host) {
            if key_matches {
                other_hosts.push(known_host.clone());
            }
            continue;
        }
        match known_host.line_type {
            KnownHostLineType::Key => {
                if key_matches {
                    accepted_known_host_found = true;
                } else {
                    // Host and key type matched but the key did not: the
                    // key changed. Only an error if no later line has the
                    // correct key.
                    latent_errors.push(KnownHostError::HostKeyHasChanged {
                        hostname: host.to_string(),
                        key_type: remote_key_type,
                        old_known_host: known_host.clone(),
                        remote_host_key: remote_host_key_encoded.clone(),
                        remote_fingerprint: remote_fingerprint.clone(),
                    });
                }
            }
            KnownHostLineType::Revoked => {
                if key_matches {
                    return Err(KnownHostError::HostKeyRevoked {
                        hostname: host.to_string(),
                        key_type: remote_key_type,
                        remote_host_key: remote_host_key_encoded,
                        location: known_host.location.clone(),
                    });
                }
            }
            KnownHostLineType::CertAuthority => {
                latent_errors.push(KnownHostError::HostHasOnlyCertAuthority {
                    hostname: host.to_string(),
                    location: known_host.location.clone(),
                });
            }
        }
    }

    // Accepted host key, and it wasn't revoked.
    if accepted_known_host_found {
        return Ok(());
    }

    if latent_errors.is_empty() {
        Err(KnownHostError::HostKeyNotFound {
            hostname: host.to_string(),
            key_type: remote_key_type,
            remote_host_key: remote_host_key_encoded,
            remote_fingerprint,
            other_hosts,
        })
    } else {
        // Take the first HostKeyHasChanged if there is one (a changed key
        // must always win over a lesser error); otherwise the first error
        // (expected to be a CertAuthority error).
        if let Some(index) = latent_errors
            .iter()
            .position(|e| matches!(e, KnownHostError::HostKeyHasChanged { .. }))
        {
            Err(latent_errors.remove(index))
        } else {
            Err(latent_errors.pop().unwrap())
        }
    }
}

/// Files to try loading OpenSSH-formatted known hosts, global then user.
fn known_host_files() -> Vec<PathBuf> {
    let mut result = Vec::new();
    if std::env::var_os("__YRYVU_TEST_DISABLE_GLOBAL_KNOWN_HOST").is_some() {
        // Test hook: skip the system file for determinism.
    } else if cfg!(unix) {
        result.push(PathBuf::from("/etc/ssh/ssh_known_hosts"));
    } else if cfg!(windows) {
        if let Some(progdata) = std::env::var_os("ProgramData") {
            let mut p = PathBuf::from(progdata);
            p.push("ssh");
            p.push("ssh_known_hosts");
            result.push(p);
        }
    }
    result.extend(user_known_host_location());
    result
}

/// The user's `~/.ssh/known_hosts`. Resolves the home dir the same way
/// the rest of the crate does (`HOME`, falling back to `USERPROFILE` on
/// Windows) rather than pulling in the `home` crate.
fn user_known_host_location() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)?;
    Some(home.join(".ssh").join("known_hosts"))
}

const HASH_HOSTNAME_PREFIX: &str = "|1|";

#[derive(Clone)]
enum KnownHostLineType {
    Key,
    CertAuthority,
    Revoked,
}

/// A single known host entry.
#[derive(Clone)]
struct KnownHost {
    location: KnownHostLocation,
    /// The hostname. May be comma separated to match multiple hosts.
    patterns: String,
    key_type: String,
    key: Vec<u8>,
    line_type: KnownHostLineType,
}

impl KnownHost {
    /// Whether the given host matches this entry.
    fn host_matches(&self, host: &str) -> bool {
        let mut match_found = false;
        let host = host.to_lowercase();
        if let Some(hashed) = self.patterns.strip_prefix(HASH_HOSTNAME_PREFIX) {
            return hashed_hostname_matches(&host, hashed);
        }
        for pattern in self.patterns.split(',') {
            let pattern = pattern.to_lowercase();

            let (negated, pattern) = match pattern.strip_prefix('!') {
                Some(rest) => (true, rest.to_string()),
                None => (false, pattern),
            };

            let matches = if is_glob_pattern(&pattern) && !is_bracketed_with_port(&pattern) {
                match glob::Pattern::new(&pattern) {
                    Ok(glob) => glob.matches(&host),
                    Err(e) => {
                        tracing::warn!("failed to interpret hostname `{pattern}` as glob: {e}");
                        false
                    }
                }
            } else {
                pattern == host
            };

            // A negation that matches preemptively rejects the whole host.
            if negated && matches {
                return false;
            }
            // A non-matching negation is not itself a match.
            match_found |= !negated && matches;
        }
        match_found
    }
}

fn is_glob_pattern(name: &str) -> bool {
    name.contains(['*', '?', '[', ']'])
}

fn is_bracketed_with_port(pattern: &str) -> bool {
    pattern.starts_with('[') && pattern.contains("]:")
}

fn hashed_hostname_matches(host: &str, hashed: &str) -> bool {
    let Some((b64_salt, b64_host)) = hashed.split_once('|') else {
        return false;
    };
    let Ok(salt) = STANDARD.decode(b64_salt) else {
        return false;
    };
    let Ok(hashed_host) = STANDARD.decode(b64_host) else {
        return false;
    };
    let Ok(mut mac) = hmac::Hmac::<sha1::Sha1>::new_from_slice(&salt) else {
        return false;
    };
    mac.update(host.as_bytes());
    let result = mac.finalize().into_bytes();
    hashed_host == result[..]
}

/// Loads an OpenSSH `known_hosts` file.
fn load_hostfile(path: &Path) -> Result<Vec<KnownHost>, String> {
    let contents = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(load_hostfile_contents(path, &contents))
}

fn load_hostfile_contents(path: &Path, contents: &str) -> Vec<KnownHost> {
    contents
        .lines()
        .enumerate()
        .filter_map(|(lineno, line)| {
            let location = KnownHostLocation::File {
                path: path.to_path_buf(),
                lineno: lineno as u32 + 1,
            };
            parse_known_hosts_line(line, location)
        })
        .collect()
}

fn parse_known_hosts_line(line: &str, location: KnownHostLocation) -> Option<KnownHost> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let mut parts = line.split([' ', '\t']).filter(|s| !s.is_empty());

    let line_type = if line.starts_with('@') {
        match parts.next()? {
            "@cert-authority" => KnownHostLineType::CertAuthority,
            "@revoked" => KnownHostLineType::Revoked,
            // No other markers are defined.
            _ => return None,
        }
    } else {
        KnownHostLineType::Key
    };

    let patterns = parts.next()?;
    let key_type = parts.next()?;
    let key = parts.next().map(|p| STANDARD.decode(p))?.ok()?;
    Some(KnownHost {
        line_type,
        location,
        patterns: patterns.to_string(),
        key_type: key_type.to_string(),
        key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Test corpus ported from Cargo's known_hosts.rs.
    static COMMON_CONTENTS: &str = r#"
        # Comments allowed at start of line

        example.com,rust-lang.org ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC5MzWIpZwpkpDjyCNiTIEVFhSA9OUUQvjFo7CgZBGCAj/cqeUIgiLsgtfmtBsfWIkAECQpM7ePP7NLZFGJcHvoyg5jXJiIX5s0eKo9IlcuTLLrMkW5MkHXE7bNklVbW1WdCfF2+y7Ao25B4L8FFRokMh0yp/H6+8xZ7PdVwL3FRPEg8ftZ5R0kuups6xiMHPRX+f/07vfJzA47YDPmXfhkn+JK8kL0JYw8iy8BtNBfRQL99d9iXJzWXnNce5NHMuKD5rOonD3aQHLDlwK+KhrFRrdaxQEM8ZWxNti0ux8yT4Dl5jJY0CrIu3Xl6+qroVgTqJGNkTbhs5DGWdFh6BLPTTH15rN4buisg7uMyLyHqx06ckborqD33gWu+Jig7O+PV6KJmL5mp1O1HXvZqkpBdTiT6GiDKG3oECCIXkUk0BSU9VG9VQcrMxxvgiHlyoXUAfYQoXv/lnxkTnm+Sr36kutsVOs7n5B43ZKAeuaxyQ11huJZpxamc0RA1HM641s= eric@host
        Example.net ssh-dss AAAAB3NzaC1kc3MAAACBAK2Ek3jVxisXmz5UcZ7W65BAj/nDJCCVvSe0Aytndn4PH6k7sVesut5OoY6PdksZ9tEfuFjjS9HR5SJb8j1GW0GxtaSHHbf+rNc36PeU75bffzyIWwpA8uZFONt5swUAXJXcsHOoapNbUFuhHsRhB2hXxz9QGNiiwIwRJeSHixKRAAAAFQChKfxO1z9H2/757697xP5nJ/Z5dwAAAIEAoc+HIWas+4WowtB/KtAp6XE0B9oHI+55wKtdcGwwb7zHKK9scWNXwxIcMhSvyB3Oe2I7dQQlvyIWxsdZlzOkX0wdsTHjIAnBAP68MyvMv4kq3+I5GAVcFsqoLZfZvh0dlcgUq1/YNYZwKlt89tnzk8Fp4KLWmuw8Bd8IShYVa78AAACAL3qd8kNTY7CthgsQ8iWdjbkGSF/1KCeFyt8UjurInp9wvPDjqagwakbyLOzN7y3/ItTPCaGuX+RjFP0zZTf8i9bsAVyjFJiJ7vzRXcWytuFWANrpzLTn1qzPfh63iK92Aw8AVBYvEA/4bxo+XReAvhNBB/m78G6OedTeu6ZoTsI= eric@host
        [example.net]:2222 ssh-dss AAAAB3NzaC1kc3MAAACBAJJN5kLZEpOJpXWyMT4KwYvLAj+b9ErNtglxOi86C6Kw7oZeYdDMCfD3lc3PJyX64udQcWGfO4abSESMiYdY43yFAZH279QGH5Q/B5CklVvTqYpfAUR+1r9TQxy3OVQHk7FB2wOi4xNQ3myO0vaYlBOB9il+P223aERbXx4JTWdvAAAAFQCTHWTcXxLK5Z6ZVPmfdSDyHzkF2wAAAIEAhp41/mTnM0Y0EWSyCXuETMW1QSpKGF8sqoZKp6wdzyhLXu0i32gLdXj4p24em/jObYh93hr+MwgxqWq+FHgD+D80Qg5f6vj4yEl4Uu5hqtTpCBFWUQoyEckbUkPf8uZ4/XzAne+tUSjZm09xATCmK9U2IGqZE+D+90eBkf1Svc8AAACAeKhi4EtfwenFYqKz60ZoEEhIsE1yI2jH73akHnfHpcW84w+fk3YlwjcfDfyYso+D0jZBdJeK5qIdkbUWhAX8wDjJVO0WL6r/YPr4yu/CgEyW1H59tAbujGJ4NR0JDqioulzYqNHnxpiw1RJukZnPBfSFKzRElvPOCq/NkQM/Mwk= eric@host
        nistp256.example.org ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBJ4iYGCcJrUIfrHfzlsv8e8kaF36qpcUpe3VNAKVCZX/BDptIdlEe8u8vKNRTPgUO9jqS0+tjTcPiQd8/8I9qng= eric@host
        nistp384.example.org ecdsa-sha2-nistp384 AAAAE2VjZHNhLXNoYTItbmlzdHAzODQAAAAIbmlzdHAzODQAAABhBNuGT3TqMz2rcwOt2ZqkiNqq7dvWPE66W2qPCoZsh0pQhVU3BnhKIc6nEr6+Wts0Z3jdF3QWwxbbTjbVTVhdr8fMCFhDCWiQFm9xLerYPKnu9qHvx9K87/fjc5+0pu4hLA== eric@host
        nistp521.example.org ecdsa-sha2-nistp521 AAAAE2VjZHNhLXNoYTItbmlzdHA1MjEAAAAIbmlzdHA1MjEAAACFBAD35HH6OsK4DN75BrKipVj/GvZaUzjPNa1F8wMjUdPB1JlVcUfgzJjWSxrhmaNN3u0soiZw8WNRFINsGPCw5E7DywF1689WcIj2Ye2rcy99je15FknScTzBBD04JgIyOI50mCUaPCBoF14vFlN6BmO00cFo+yzy5N8GuQ2sx9kr21xmFQ== eric@host
        # Revoked is supported, but without Cert-Authority support, it will only negate some other fixed key.
        @revoked revoked.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKtQsi+KPYispwm2rkMidQf30fG1Niy8XNkvASfePoca eric@host
        # Cert-Authority is not supported (below key should not be valid anyway)
        @cert-authority ca.example.com ssh-rsa AABBB5Wm
        example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAWkjI6XT2SZh3xNk5NhisA3o3sGzWR+VAKMSqHtI0aY eric@host
        192.168.42.12 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKVYJpa0yUGaNk0NXQTPWa0tHjqRpx+7hl2diReH6DtR eric@host
        |1|QxzZoTXIWLhUsuHAXjuDMIV3FjQ=|M6NCOIkjiWdCWqkh5+Q+/uFLGjs= ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIHgN3O21U4LWtP5OzjTzPnUnSDmCNDvyvlaj6Hi65JC eric@host
        # Negation isn't terribly useful without globs.
        neg.example.com,!neg.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOXfUnaAHTlo1Qi//rNk26OcmHikmkns1Z6WW/UuuS3K eric@host
        # Glob patterns
        *.asterisk.glob.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO6/wm8Z5aVL2cDyALY6zE7KVW0s64utWTUmbAvvSKlI eric@host
        test?.question.glob.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKceiey2vuK/WB/kLsiGa85xw897JzvGGaHmkAZbVHf3 eric@host
    "#;

    #[test]
    fn known_hosts_parse() {
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, COMMON_CONTENTS);
        assert_eq!(khs.len(), 14);
        match &khs[0].location {
            KnownHostLocation::File { path, lineno } => {
                assert_eq!(path, kh_path);
                assert_eq!(*lineno, 4);
            }
            _ => panic!("unexpected"),
        }
        assert_eq!(khs[0].patterns, "example.com,rust-lang.org");
        assert_eq!(khs[0].key_type, "ssh-rsa");
        assert_eq!(khs[0].key.len(), 407);
        assert_eq!(khs[2].patterns, "[example.net]:2222");
        assert_eq!(khs[3].patterns, "nistp256.example.org");
        assert_eq!(khs[9].patterns, "192.168.42.12");
    }

    #[test]
    fn host_matches() {
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, COMMON_CONTENTS);
        assert!(khs[0].host_matches("example.com"));
        assert!(khs[0].host_matches("rust-lang.org"));
        assert!(khs[0].host_matches("EXAMPLE.COM"));
        assert!(khs[1].host_matches("example.net"));
        assert!(!khs[0].host_matches("example.net"));
        assert!(khs[2].host_matches("[example.net]:2222"));
        assert!(!khs[2].host_matches("example.net"));
        assert!(khs[10].host_matches("hashed.example.com"));
        assert!(!khs[10].host_matches("example.com"));
        assert!(!khs[11].host_matches("neg.example.com"));

        // Glob patterns.
        assert!(khs[12].host_matches("matches.asterisk.glob.example.com"));
        assert!(!khs[12].host_matches("matches.not.glob.example.com"));
        assert!(khs[13].host_matches("test3.question.glob.example.com"));
        assert!(!khs[13].host_matches("test120.question.glob.example.com"));
    }

    #[test]
    fn check_match() {
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, COMMON_CONTENTS);

        assert!(check_ssh_known_hosts_loaded(
            &khs,
            "example.com",
            SshHostKeyType::Rsa,
            &khs[0].key
        )
        .is_ok());

        match check_ssh_known_hosts_loaded(&khs, "example.com", SshHostKeyType::Dss, &khs[0].key) {
            Err(KnownHostError::HostKeyNotFound {
                hostname,
                remote_fingerprint,
                other_hosts,
                ..
            }) => {
                assert_eq!(
                    remote_fingerprint,
                    "yn+pONDn0EcgdOCVptgB4RZd/wqmsVKrPnQMLtrvhw8"
                );
                assert_eq!(hostname, "example.com");
                assert_eq!(other_hosts.len(), 0);
            }
            _ => panic!("unexpected"),
        }

        match check_ssh_known_hosts_loaded(
            &khs,
            "foo.example.com",
            SshHostKeyType::Rsa,
            &khs[0].key,
        ) {
            Err(KnownHostError::HostKeyNotFound { other_hosts, .. }) => {
                assert_eq!(other_hosts.len(), 1);
                assert_eq!(other_hosts[0].patterns, "example.com,rust-lang.org");
            }
            _ => panic!("unexpected"),
        }

        let mut modified_key = khs[0].key.clone();
        modified_key[0] = 1;
        match check_ssh_known_hosts_loaded(&khs, "example.com", SshHostKeyType::Rsa, &modified_key)
        {
            Err(KnownHostError::HostKeyHasChanged { old_known_host, .. }) => {
                assert!(matches!(
                    old_known_host.location,
                    KnownHostLocation::File { lineno: 4, .. }
                ));
            }
            _ => panic!("unexpected"),
        }
    }

    #[test]
    fn revoked() {
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, COMMON_CONTENTS);

        match check_ssh_known_hosts_loaded(
            &khs,
            "revoked.example.com",
            SshHostKeyType::Ed255219,
            &khs[6].key,
        ) {
            Err(KnownHostError::HostKeyRevoked {
                hostname, location, ..
            }) => {
                assert_eq!("revoked.example.com", hostname);
                assert!(matches!(
                    location,
                    KnownHostLocation::File { lineno: 11, .. }
                ));
            }
            _ => panic!("Expected key to be revoked for revoked.example.com."),
        }
    }

    #[test]
    fn cert_authority() {
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, COMMON_CONTENTS);

        match check_ssh_known_hosts_loaded(
            &khs,
            "ca.example.com",
            SshHostKeyType::Rsa,
            &khs[0].key, // The key should not matter.
        ) {
            Err(KnownHostError::HostHasOnlyCertAuthority {
                hostname, location, ..
            }) => {
                assert_eq!("ca.example.com", hostname);
                assert!(matches!(
                    location,
                    KnownHostLocation::File { lineno: 13, .. }
                ));
            }
            _ => panic!("Expected host to only have @cert-authority line (unsupported)."),
        }
    }

    #[test]
    fn changed_key_wins_over_cert_authority() {
        let contents = r#"
        not-used.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAWkjI6XT2SZh3xNk5NhisA3o3sGzWR+VAKMSqHtI0aY eric@host
        # Cert-authority and changed key for the same host - changed key error should prevail.
        @cert-authority example.com ssh-ed25519 AABBB5Wm
        example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKVYJpa0yUGaNk0NXQTPWa0tHjqRpx+7hl2diReH6DtR eric@host
        "#;
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, contents);

        match check_ssh_known_hosts_loaded(
            &khs,
            "example.com",
            SshHostKeyType::Ed255219,
            &khs[0].key,
        ) {
            Err(KnownHostError::HostKeyHasChanged {
                hostname,
                old_known_host,
                ..
            }) => {
                assert_eq!("example.com", hostname);
                assert!(matches!(
                    old_known_host.location,
                    KnownHostLocation::File { lineno: 5, .. }
                ));
            }
            _ => panic!("Expected HostKeyHasChanged to win over cert-authority."),
        }
    }

    #[test]
    fn known_host_and_revoked() {
        let contents = r#"
        example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKVYJpa0yUGaNk0NXQTPWa0tHjqRpx+7hl2diReH6DtR eric@host
        # Later in the file the same host key is revoked.
        @revoked example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKVYJpa0yUGaNk0NXQTPWa0tHjqRpx+7hl2diReH6DtR eric@host
        "#;
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, contents);

        match check_ssh_known_hosts_loaded(
            &khs,
            "example.com",
            SshHostKeyType::Ed255219,
            &khs[0].key,
        ) {
            Err(KnownHostError::HostKeyRevoked {
                hostname, location, ..
            }) => {
                assert_eq!("example.com", hostname);
                assert!(matches!(
                    location,
                    KnownHostLocation::File { lineno: 4, .. }
                ));
            }
            _ => panic!("Expected HostKeyRevoked — a revoked key must never be accepted."),
        }
    }

    #[test]
    fn negated_glob_rejects_match() {
        let contents = r#"
            *example.com,!*h.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKVYJpa0yUGaNk0NXQTPWa0tHjqRpx+7hl2diReH6DtR
            "#;
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, contents);

        assert!(khs[0].host_matches("web.example.com"));
        assert!(
            !khs[0].host_matches("ssh.example.com"),
            "negated glob !*h.example.com should reject ssh.example.com"
        );
    }

    #[test]
    fn bracketed_host_with_port() {
        let contents = r#"
            [example.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKVYJpa0yUGaNk0NXQTPWa0tHjqRpx+7hl2diReH6DtR
            "#;
        let kh_path = Path::new("/home/abc/.known_hosts");
        let khs = load_hostfile_contents(kh_path, contents);

        assert!(
            !khs[0].host_matches("e:2222"),
            "bracketed host with port must not be glob matched"
        );
        assert!(
            !khs[0].host_matches("[example.com]:443"),
            "bracketed host with a different port must not match"
        );
        assert!(khs[0].host_matches("[example.com]:2222"));
    }

    /// The public verdict maps a first-contact host to `Unknown` with a
    /// re-appendable line, and this line round-trips back to `Trusted`.
    #[test]
    fn verdict_unknown_then_trusted_roundtrip() {
        // ed25519 key from the corpus (line 12, example.com).
        let key_b64 = "AAAAC3NzaC1lZDI1NTE5AAAAIAWkjI6XT2SZh3xNk5NhisA3o3sGzWR+VAKMSqHtI0aY";
        let key = STANDARD.decode(key_b64).unwrap();

        // No entry for this host → HostKeyNotFound.
        let empty: Vec<KnownHost> = Vec::new();
        let not_found = check_ssh_known_hosts_loaded(
            &empty,
            "fresh.example.com",
            SshHostKeyType::Ed255219,
            &key,
        );
        assert!(matches!(
            not_found,
            Err(KnownHostError::HostKeyNotFound { .. })
        ));

        // Appending the exact line the prompt would write makes it trusted.
        let line = format!("fresh.example.com ssh-ed25519 {key_b64}");
        let khs = load_hostfile_contents(Path::new("/x"), &line);
        assert!(check_ssh_known_hosts_loaded(
            &khs,
            "fresh.example.com",
            SshHostKeyType::Ed255219,
            &key
        )
        .is_ok());
    }

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
