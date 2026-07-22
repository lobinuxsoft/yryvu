// SPDX-License-Identifier: AGPL-3.0-or-later

//! Minimal `~/.ssh/config` reader (#508).
//!
//! libssh2 does not read the OpenSSH client config, so a user whose key
//! isn't at a default name — `IdentityFile ~/.ssh/work_ed25519` under
//! `Host github.com` — would fail to authenticate even though `git` on
//! the same machine succeeds. This parses the small subset the
//! credential callback needs to close that gap.
//!
//! **Scope, on purpose:**
//! - `Host` (with `*`/`?` globs), `HostName`, `User`, `IdentityFile`,
//!   `Port`. First value wins per key, across all matching blocks —
//!   OpenSSH semantics.
//! - **No `Include`.** Chasing includes means walking arbitrary paths;
//!   deferred until asked for.
//! - **No `ProxyCommand` / `Match exec` / any directive that runs a
//!   program.** Executing a command pulled from a config file is a
//!   command-injection surface; this reader will never do it.
//! - `HostName` rewriting (alias → real address) is parsed but the
//!   caller currently uses only `IdentityFile`/`User`; wiring the
//!   address rewrite needs an anonymous-remote fetch path and is
//!   tracked separately.

use std::path::{Path, PathBuf};

/// Values resolved for a single host, first-match-wins per field.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct HostConfig {
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    /// In declared order. OpenSSH tries each; we do the same.
    pub identity_files: Vec<PathBuf>,
}

/// One parsed `Host` block: its patterns plus the directives under it,
/// kept in file order so first-match-wins is a straight forward scan.
#[derive(Debug, Clone)]
struct HostBlock {
    patterns: Vec<String>,
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_files: Vec<PathBuf>,
}

/// Resolve config for `host` from the user's `~/.ssh/config`, if any.
/// Returns `HostConfig::default()` when the file is absent or nothing
/// matches — the caller then falls back to default key names.
pub fn resolve_host(host: &str) -> HostConfig {
    let Some(home) = home_dir() else {
        return HostConfig::default();
    };
    let path = home.join(".ssh").join("config");
    match std::fs::read_to_string(&path) {
        Ok(text) => resolve_from_str(&text, host, &home),
        Err(_) => HostConfig::default(),
    }
}

/// Testable core: resolve against config text with an explicit home so
/// `~` expansion is deterministic under test.
pub fn resolve_from_str(text: &str, host: &str, home: &Path) -> HostConfig {
    let blocks = parse_blocks(text, home);
    let mut out = HostConfig::default();
    for block in &blocks {
        if !block.patterns.iter().any(|p| pattern_matches(p, host)) {
            continue;
        }
        // First value wins per field.
        if out.hostname.is_none() {
            out.hostname = block.hostname.clone();
        }
        if out.user.is_none() {
            out.user = block.user.clone();
        }
        if out.port.is_none() {
            out.port = block.port;
        }
        out.identity_files
            .extend(block.identity_files.iter().cloned());
    }
    out
}

fn parse_blocks(text: &str, home: &Path) -> Vec<HostBlock> {
    let mut blocks: Vec<HostBlock> = Vec::new();
    let mut current: Option<HostBlock> = None;

    for raw in text.lines() {
        let line = strip_comment(raw).trim();
        if line.is_empty() {
            continue;
        }
        let Some((keyword, value)) = split_directive(line) else {
            continue;
        };
        let key = keyword.to_ascii_lowercase();

        if key == "host" {
            if let Some(block) = current.take() {
                blocks.push(block);
            }
            current = Some(HostBlock {
                patterns: value.split_whitespace().map(str::to_string).collect(),
                hostname: None,
                user: None,
                port: None,
                identity_files: Vec::new(),
            });
            continue;
        }

        // Directives before any `Host` (or `Match`, which we ignore)
        // have no block to attach to.
        let Some(block) = current.as_mut() else {
            continue;
        };

        match key.as_str() {
            "hostname" => block.hostname.get_or_insert_with(|| value.to_string()),
            "user" => block.user.get_or_insert_with(|| value.to_string()),
            "port" => {
                if block.port.is_none() {
                    block.port = value.parse().ok();
                }
                continue;
            }
            "identityfile" => {
                block.identity_files.push(expand_tilde(value, home));
                continue;
            }
            // Everything else — including ProxyCommand and Match — is
            // deliberately ignored, not executed.
            _ => continue,
        };
    }

    if let Some(block) = current.take() {
        blocks.push(block);
    }
    blocks
}

/// Strip an unquoted `#` comment. OpenSSH treats `#` as a comment only
/// outside quotes; values here are simple enough that we split on the
/// first `#`.
fn strip_comment(line: &str) -> &str {
    match line.find('#') {
        Some(i) => &line[..i],
        None => line,
    }
}

/// Split `Keyword value` or `Keyword=value`. OpenSSH accepts either an
/// `=` or whitespace between a keyword and its argument.
fn split_directive(line: &str) -> Option<(&str, &str)> {
    if let Some((k, v)) = line.split_once('=') {
        return Some((k.trim(), v.trim()));
    }
    let (k, v) = line.split_once(char::is_whitespace)?;
    Some((k.trim(), v.trim()))
}

fn expand_tilde(value: &str, home: &Path) -> PathBuf {
    if let Some(rest) = value.strip_prefix("~/") {
        return home.join(rest);
    }
    if value == "~" {
        return home.to_path_buf();
    }
    PathBuf::from(value)
}

/// OpenSSH `Host` pattern match: `*` (any run), `?` (one char), literal
/// otherwise, case-insensitive on the host. No negation (`!pat`) — a
/// rare feature we don't parse; such a pattern simply won't match,
/// which fails safe (fewer keys offered, never more).
fn pattern_matches(pattern: &str, host: &str) -> bool {
    if pattern.starts_with('!') {
        return false;
    }
    glob_match(
        pattern.to_ascii_lowercase().as_bytes(),
        host.to_ascii_lowercase().as_bytes(),
    )
}

/// Iterative `*`/`?` glob. Linear-time via the standard backtracking
/// pointer pair — no recursion, no catastrophic input.
fn glob_match(pat: &[u8], text: &[u8]) -> bool {
    let (mut p, mut t) = (0usize, 0usize);
    let (mut star, mut mark): (Option<usize>, usize) = (None, 0);
    while t < text.len() {
        if p < pat.len() && (pat[p] == b'?' || pat[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pat.len() && pat[p] == b'*' {
            star = Some(p);
            mark = t;
            p += 1;
        } else if let Some(s) = star {
            p = s + 1;
            mark += 1;
            t = mark;
        } else {
            return false;
        }
    }
    while p < pat.len() && pat[p] == b'*' {
        p += 1;
    }
    p == pat.len()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/home/tester")
    }

    #[test]
    fn resolves_identity_file_for_exact_host() {
        let cfg = "\
Host github.com
    User git
    IdentityFile ~/.ssh/work_ed25519
";
        let r = resolve_from_str(cfg, "github.com", &home());
        assert_eq!(r.user.as_deref(), Some("git"));
        assert_eq!(
            r.identity_files,
            vec![PathBuf::from("/home/tester/.ssh/work_ed25519")]
        );
    }

    #[test]
    fn first_value_wins_across_matching_blocks() {
        // A specific block then a `*` catch-all: OpenSSH keeps the first
        // value for User, but accumulates every IdentityFile.
        let cfg = "\
Host github.com
    User git
    IdentityFile ~/.ssh/specific

Host *
    User nobody
    IdentityFile ~/.ssh/id_ed25519
";
        let r = resolve_from_str(cfg, "github.com", &home());
        assert_eq!(r.user.as_deref(), Some("git"));
        assert_eq!(
            r.identity_files,
            vec![
                PathBuf::from("/home/tester/.ssh/specific"),
                PathBuf::from("/home/tester/.ssh/id_ed25519"),
            ]
        );
    }

    #[test]
    fn glob_and_question_mark_patterns() {
        let cfg = "\
Host *.example.com
    IdentityFile ~/.ssh/example

Host 10.0.0.?
    IdentityFile ~/.ssh/lan
";
        assert_eq!(
            resolve_from_str(cfg, "git.example.com", &home()).identity_files,
            vec![PathBuf::from("/home/tester/.ssh/example")]
        );
        assert_eq!(
            resolve_from_str(cfg, "10.0.0.7", &home()).identity_files,
            vec![PathBuf::from("/home/tester/.ssh/lan")]
        );
        assert!(resolve_from_str(cfg, "10.0.0.42", &home())
            .identity_files
            .is_empty());
    }

    #[test]
    fn hostname_and_port_parsed() {
        let cfg = "\
Host gh
    HostName github.com
    Port 2222
";
        let r = resolve_from_str(cfg, "gh", &home());
        assert_eq!(r.hostname.as_deref(), Some("github.com"));
        assert_eq!(r.port, Some(2222));
    }

    #[test]
    fn equals_separator_and_case_insensitive_keywords() {
        let cfg = "\
host=github.com
    IDENTITYFILE=~/.ssh/k
";
        let r = resolve_from_str(cfg, "github.com", &home());
        assert_eq!(r.identity_files, vec![PathBuf::from("/home/tester/.ssh/k")]);
    }

    #[test]
    fn comments_and_blank_lines_ignored() {
        let cfg = "\
# a comment
Host github.com   # trailing
    IdentityFile ~/.ssh/k  # inline

";
        let r = resolve_from_str(cfg, "github.com", &home());
        assert_eq!(r.identity_files, vec![PathBuf::from("/home/tester/.ssh/k")]);
    }

    #[test]
    fn proxycommand_is_ignored_never_executed() {
        // The whole point: a directive that would run a program is
        // parsed past, not acted on.
        let cfg = "\
Host evil
    ProxyCommand rm -rf /
    IdentityFile ~/.ssh/k
";
        let r = resolve_from_str(cfg, "evil", &home());
        // We keep the safe field and simply never surface the command.
        assert_eq!(r.identity_files, vec![PathBuf::from("/home/tester/.ssh/k")]);
    }

    #[test]
    fn negated_pattern_does_not_match() {
        let cfg = "\
Host !github.com
    IdentityFile ~/.ssh/k
";
        assert!(resolve_from_str(cfg, "github.com", &home())
            .identity_files
            .is_empty());
    }

    #[test]
    fn directives_before_any_host_are_dropped() {
        let cfg = "\
IdentityFile ~/.ssh/orphan
Host github.com
    IdentityFile ~/.ssh/k
";
        let r = resolve_from_str(cfg, "github.com", &home());
        assert_eq!(r.identity_files, vec![PathBuf::from("/home/tester/.ssh/k")]);
    }

    #[test]
    fn no_match_is_empty() {
        let cfg = "Host gitlab.com\n    IdentityFile ~/.ssh/gl\n";
        assert_eq!(
            resolve_from_str(cfg, "github.com", &home()),
            HostConfig::default()
        );
    }

    #[test]
    fn absolute_identity_path_left_alone() {
        let cfg = "Host h\n    IdentityFile /etc/keys/id\n";
        assert_eq!(
            resolve_from_str(cfg, "h", &home()).identity_files,
            vec![PathBuf::from("/etc/keys/id")]
        );
    }
}
