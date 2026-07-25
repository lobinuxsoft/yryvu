// SPDX-License-Identifier: AGPL-3.0-or-later

//! The known_hosts decision core: match a remote host key against the
//! loaded entries and classify the result as trusted, unknown, changed,
//! revoked, or CA-only. Ported verbatim from Cargo's `known_hosts.rs` —
//! every branch here is load-bearing security logic; do not "simplify".

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine as _;
use git2::cert::{CertHostkey, SshHostKeyType};
use sha2::{Digest as _, Sha256};

use super::bundled;
use super::parse::{self, KnownHost, KnownHostLineType, KnownHostLocation};

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
    for path in parse::known_host_files() {
        if !path.exists() {
            continue;
        }
        match parse::load_hostfile(&path) {
            Ok(hosts) => known_hosts.extend(hosts),
            Err(e) => tracing::warn!("failed to read known_hosts {}: {e}", path.display()),
        }
    }
    bundled::load_bundled(&mut known_hosts);

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::remote::known_hosts::parse::load_hostfile_contents;
    use std::path::Path;

    // Test corpus ported from Cargo's known_hosts.rs.
    static COMMON_CONTENTS: &str = r#"
        # Comments allowed at start of line

        example.com,rust-lang.org ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC5MzWIpZwpkpDjyCNiTIEVFhSA9OUUQvjFo7CgZBGCAj/cqeUIgiLsgtfmtBsfWIkAECQpM7ePP7NLZFGJcHvoyg5jXJiIX5s0eKo9IlcuTLLrMkW5MkHXE7bNklVbW1WdCfF2+y7Ao25B4L8FFRokMh0yp/H6+8xZ7PdVwL3FRPEg8ftZ5R0kuups6xiMHPRX+f/07vfJzA47YDPmXfhkn+JK8kL0JYw8iy8BtNBfRQL99d9iXJzWXnNce5NHMuKD5rOonD3aQHLDlwK+KhrFRrdaxQEM8ZWxNti0ux8yT4Dl5jJY0CrIu3Xl6+qroVgTqJGNkTbhs5DGWdFh6BLPTTH15rN4buisg7uMyLyHqx06ckborqD33gWu+Jig7O+PV6KJmL5mp1O1HXvZqkpBdTiT6GiDKG3oECCIXkUk0BSU9VG9VQcrMxxvgiHlyoXUAfYQoXv/lnxkTnm+Sr36kutsVOs7n5B43ZKAeuaxyQ11huJZpxamc0RA1HM641s= eric@host
        @revoked revoked.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKtQsi+KPYispwm2rkMidQf30fG1Niy8XNkvASfePoca eric@host
        @cert-authority ca.example.com ssh-rsa AABBB5Wm
        example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAWkjI6XT2SZh3xNk5NhisA3o3sGzWR+VAKMSqHtI0aY eric@host
    "#;

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
            &khs[1].key,
        ) {
            Err(KnownHostError::HostKeyRevoked {
                hostname, location, ..
            }) => {
                assert_eq!("revoked.example.com", hostname);
                assert!(matches!(
                    location,
                    KnownHostLocation::File { lineno: 5, .. }
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
                    KnownHostLocation::File { lineno: 6, .. }
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

    /// A first-contact host maps to `HostKeyNotFound`, and the exact line
    /// a prompt would append round-trips back to accepted.
    #[test]
    fn unknown_then_trusted_roundtrip() {
        let key_b64 = "AAAAC3NzaC1lZDI1NTE5AAAAIAWkjI6XT2SZh3xNk5NhisA3o3sGzWR+VAKMSqHtI0aY";
        let key = STANDARD.decode(key_b64).unwrap();

        let empty: Vec<KnownHost> = Vec::new();
        assert!(matches!(
            check_ssh_known_hosts_loaded(
                &empty,
                "fresh.example.com",
                SshHostKeyType::Ed255219,
                &key
            ),
            Err(KnownHostError::HostKeyNotFound { .. })
        ));

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
}
