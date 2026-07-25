// SPDX-License-Identifier: AGPL-3.0-or-later

//! Host keys and revocations bundled with yryvu, sourced from
//! <https://api.github.com/meta>. Ported from Cargo's `known_hosts.rs`.

use std::collections::HashSet;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

use super::parse::{KnownHost, KnownHostLineType, KnownHostLocation};

/// Host keys hard-coded for convenience. Ignored for a host the user has
/// their own entry for, so they can always override (useful if a key is
/// rotated).
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
/// not overridable — we *know* they are bad.
static BUNDLED_REVOCATIONS: &[(&str, &str, &str)] = &[
    // Used until March 24, 2023: https://github.blog/2023-03-23-we-updated-our-rsa-ssh-host-key/
    (
        "github.com",
        "ssh-rsa",
        "AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==",
    ),
];

/// Populate the bundled keys and revocations. Bundled keys are skipped
/// for hosts the user already configured (override path); revocations
/// are always added.
pub(super) fn load_bundled(known_hosts: &mut Vec<KnownHost>) {
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
