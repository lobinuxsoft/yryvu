// SPDX-License-Identifier: AGPL-3.0-or-later

//! Parsing OpenSSH `known_hosts` lines and matching a host against an
//! entry's patterns (comma lists, globs, negation, and hashed `|1|`
//! entries). Ported from Cargo's `known_hosts.rs`.

use std::fmt::{self, Display};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use hmac::Mac as _;

const HASH_HOSTNAME_PREFIX: &str = "|1|";

#[derive(Clone)]
pub(super) enum KnownHostLineType {
    Key,
    CertAuthority,
    Revoked,
}

/// The location where a host key was found.
#[derive(Clone)]
pub(super) enum KnownHostLocation {
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

/// A single known host entry.
#[derive(Clone)]
pub(super) struct KnownHost {
    pub(super) location: KnownHostLocation,
    /// The hostname. May be comma separated to match multiple hosts.
    pub(super) patterns: String,
    pub(super) key_type: String,
    pub(super) key: Vec<u8>,
    pub(super) line_type: KnownHostLineType,
}

impl KnownHost {
    /// Whether the given host matches this entry.
    pub(super) fn host_matches(&self, host: &str) -> bool {
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

/// Files to try loading OpenSSH-formatted known hosts, global then user.
pub(super) fn known_host_files() -> Vec<PathBuf> {
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
pub(super) fn user_known_host_location() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)?;
    Some(home.join(".ssh").join("known_hosts"))
}

/// Loads an OpenSSH `known_hosts` file.
pub(super) fn load_hostfile(path: &Path) -> Result<Vec<KnownHost>, String> {
    let contents = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(load_hostfile_contents(path, &contents))
}

pub(super) fn load_hostfile_contents(path: &Path, contents: &str) -> Vec<KnownHost> {
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
}
