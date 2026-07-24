// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;
use std::sync::Mutex;

use super::known_hosts::{self, HostKeyVerdict};
use super::ssh_config;
use super::tofu;

/// Tries SSH agent → git credential helper → default credential, in
/// that order. Reused by every git2 op that hits the network (push,
/// fetch, push_tag, delete_remote_branch, …) so credential resolution
/// stays centralized.
pub fn build_credentials_callbacks() -> git2::RemoteCallbacks<'static> {
    build_callbacks_inner(None)
}

/// Variant that prepends an integration-token attempt before the
/// system fallbacks. Powers the Clone dialog's per-provider sub-tabs
/// (#374) where the user has already authenticated via OAuth/PAT but
/// the system git credential helper has no record of it.
///
/// Username convention per provider when the API token is the
/// password:
///
/// - GitHub / Gitea / Bitbucket app password: any non-empty username
///   works; we use the placeholder `"x-access-token"`.
/// - GitLab: requires the literal `"oauth2"` username for personal
///   access tokens (per GitLab docs `Authenticating with HTTP/S` —
///   anything else is rejected).
pub fn build_credentials_callbacks_with_token(
    integration_type: &str,
    token: String,
) -> git2::RemoteCallbacks<'static> {
    let username = token_username_for(integration_type).to_string();
    build_callbacks_inner(Some((username, token)))
}

fn token_username_for(integration_type: &str) -> &'static str {
    match integration_type {
        "gitlab" | "gitlabSelfHosted" => "oauth2",
        _ => "x-access-token",
    }
}

fn build_callbacks_inner(token: Option<(String, String)>) -> git2::RemoteCallbacks<'static> {
    let mut callbacks = git2::RemoteCallbacks::new();

    // Verify SSH host keys ourselves. Without a `certificate_check`,
    // libgit2 does its own known_hosts check — but git2-rs discards the
    // `valid` bit it produces, so a callback can't see the result. To
    // tell a new host (prompt) from a changed key (reject) we re-run the
    // check here. Registered on the shared builder so every network op
    // (fetch / pull / push / clone) is covered by one place.
    callbacks.certificate_check(verify_host_key);

    let token_attempt = Mutex::new(false);
    callbacks.credentials(move |url, username_from_url, allowed| {
        // Token first when present and we haven't tried it yet on
        // this credential round — libgit2 can call the callback
        // multiple times if the first attempt is rejected; the flag
        // prevents a tight loop returning the same bad token.
        if let Some((user, pass)) = &token {
            if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
                let mut tried = token_attempt.lock().unwrap();
                if !*tried {
                    *tried = true;
                    if let Ok(cred) = git2::Cred::userpass_plaintext(user, pass) {
                        return Ok(cred);
                    }
                }
            }
        }
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            if let Some(cred) = try_ssh_key(url, username_from_url) {
                return Ok(cred);
            }
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(cfg) = git2::Config::open_default() {
                if let Ok(cred) = git2::Cred::credential_helper(&cfg, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        if allowed.contains(git2::CredentialType::DEFAULT) {
            if let Ok(cred) = git2::Cred::default() {
                return Ok(cred);
            }
        }
        Err(git2::Error::from_str(
            "no credentials available (tried integration token, SSH agent, on-disk keys, git credential helper, default)",
        ))
    });
    callbacks
}

/// git2 `certificate_check` callback. Passes TLS certs through to
/// libgit2's own validation and verifies SSH host keys against
/// `known_hosts`, prompting the user (TOFU) only for a genuinely unknown
/// host. A changed, revoked, or unverifiable key is rejected — never
/// prompted — so an accepted prompt can never be a man-in-the-middle.
fn verify_host_key(
    cert: &git2::cert::Cert<'_>,
    host: &str,
) -> Result<git2::CertificateCheckStatus, git2::Error> {
    use git2::CertificateCheckStatus;

    let Some(host_key) = cert.as_hostkey() else {
        // Not an SSH host key (e.g. an HTTPS X.509 cert). Defer to
        // libgit2's TLS validation.
        return Ok(CertificateCheckStatus::CertificatePassthrough);
    };

    match known_hosts::verify(host_key, host) {
        HostKeyVerdict::Trusted => Ok(CertificateCheckStatus::CertificateOk),
        HostKeyVerdict::Unknown {
            host,
            key_type,
            key_b64,
            fingerprint,
        } => {
            if tofu::request_trust(&host, &key_type, &key_b64, &fingerprint) {
                Ok(CertificateCheckStatus::CertificateOk)
            } else {
                Err(git2::Error::from_str(&format!(
                    "SSH host key for {host} ({fingerprint}) was not trusted"
                )))
            }
        }
        HostKeyVerdict::Changed {
            host,
            fingerprint,
            old_location,
        } => Err(git2::Error::from_str(&format!(
            "SSH host key for {host} has CHANGED (now {fingerprint}, previously recorded at \
             {old_location}). This may be a man-in-the-middle attack — refusing to connect. If \
             the server legitimately rotated its key, remove the old known_hosts entry and retry."
        ))),
        HostKeyVerdict::Revoked { host, location } => Err(git2::Error::from_str(&format!(
            "SSH host key for {host} is REVOKED ({location}) and must not be accepted."
        ))),
        HostKeyVerdict::CertAuthorityOnly { host, location } => {
            Err(git2::Error::from_str(&format!(
                "SSH host {host} is covered only by an unsupported @cert-authority entry \
                 ({location}); its key cannot be verified."
            )))
        }
        HostKeyVerdict::Unavailable => Err(git2::Error::from_str(
            "could not read the remote SSH host key to verify it",
        )),
    }
}

/// Resolve an SSH credential: the agent first, then on-disk keys.
///
/// The agent is preferred because it never exposes key material to this
/// process and transparently handles passphrase-protected keys. On-disk
/// keys are the fallback for users who don't run an agent; the key path
/// comes from `~/.ssh/config`'s `IdentityFile` for the URL's host when
/// present, otherwise the default key names OpenSSH itself tries.
///
/// Passphrase-protected keys with no agent are not prompted for in this
/// pass — `Cred::ssh_key` gets `None`, so such a key is skipped rather
/// than hanging. Documented as a known gap; the agent covers the common
/// case.
fn try_ssh_key(url: &str, username_from_url: Option<&str>) -> Option<git2::Cred> {
    let user = username_from_url.unwrap_or("git");

    if let Ok(cred) = git2::Cred::ssh_key_from_agent(user) {
        return Some(cred);
    }

    for key in candidate_key_paths(url) {
        if !key.exists() {
            continue;
        }
        // Hand libgit2 the matching `.pub` when it's on disk; libssh2
        // can derive it otherwise, so its absence isn't fatal.
        let pubkey = key.with_extension("pub");
        let pubkey = pubkey.exists().then_some(pubkey);
        if let Ok(cred) = git2::Cred::ssh_key(user, pubkey.as_deref(), &key, None) {
            return Some(cred);
        }
    }
    None
}

/// On-disk private keys to try, in order: the host's `IdentityFile`
/// entries from `~/.ssh/config`, then OpenSSH's default key names. Never
/// logged — key paths are user-identifying and some deployments treat
/// them as secret-adjacent.
fn candidate_key_paths(url: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(host) = ssh_host_from_url(url) {
        paths.extend(ssh_config::resolve_host(&host).identity_files);
    }

    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let ssh = home.join(".ssh");
        // OpenSSH's default identity order (modern algorithms first).
        for name in ["id_ed25519", "id_ecdsa", "id_rsa"] {
            let p = ssh.join(name);
            if !paths.contains(&p) {
                paths.push(p);
            }
        }
    }
    paths
}

/// Pull the host out of an SSH git URL for `~/.ssh/config` lookup.
/// Handles both `git@host:path` (scp-like) and `ssh://[user@]host[:port]/path`.
fn ssh_host_from_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("ssh://").unwrap_or(url);
    // Drop an optional `user@`.
    let after_user = rest.rsplit_once('@').map_or(rest, |(_, h)| h);
    // Host ends at the first `:` (scp path or ssh port) or `/`.
    let end = after_user.find([':', '/']).unwrap_or(after_user.len());
    let host = &after_user[..end];
    (!host.is_empty()).then(|| host.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_username_gitlab_uses_oauth2() {
        assert_eq!(token_username_for("gitlab"), "oauth2");
        assert_eq!(token_username_for("gitlabSelfHosted"), "oauth2");
    }

    #[test]
    fn token_username_other_providers_use_placeholder() {
        for t in [
            "github",
            "githubEnterprise",
            "gitea",
            "giteaSelfHosted",
            "bitbucket",
        ] {
            assert_eq!(token_username_for(t), "x-access-token");
        }
    }

    #[test]
    fn host_from_scp_like_url() {
        assert_eq!(
            ssh_host_from_url("git@github.com:user/repo.git").as_deref(),
            Some("github.com")
        );
    }

    #[test]
    fn host_from_ssh_url_with_port() {
        assert_eq!(
            ssh_host_from_url("ssh://git@example.com:2222/user/repo.git").as_deref(),
            Some("example.com")
        );
    }

    #[test]
    fn host_from_ssh_url_without_user() {
        assert_eq!(
            ssh_host_from_url("ssh://example.com/user/repo.git").as_deref(),
            Some("example.com")
        );
    }

    #[test]
    fn https_url_has_no_ssh_host_component_we_care_about() {
        // Not an SSH URL, but the extractor shouldn't panic — it just
        // returns whatever precedes the first `:`/`/`, which the caller
        // only ever uses for an ssh_config lookup that won't match.
        assert_eq!(
            ssh_host_from_url("https://github.com/u/r.git").as_deref(),
            Some("https")
        );
    }

    #[test]
    fn default_key_names_are_offered_in_modern_first_order() {
        // With no HOME match and no config, the fallback list is the
        // default key names. Uses a scoped HOME so the test is
        // deterministic regardless of the runner's real ~/.ssh.
        let tmp = std::env::temp_dir().join("yryvu-ssh-key-order-test");
        let paths = {
            // SAFETY: single-threaded test, restored immediately after.
            let prev = std::env::var_os("HOME");
            unsafe { std::env::set_var("HOME", &tmp) };
            let p = candidate_key_paths("git@unknown-host.invalid:u/r.git");
            match prev {
                Some(v) => unsafe { std::env::set_var("HOME", v) },
                None => unsafe { std::env::remove_var("HOME") },
            }
            p
        };
        let names: Vec<_> = paths
            .iter()
            .filter_map(|p| p.file_name().and_then(|n| n.to_str()))
            .collect();
        assert_eq!(names, vec!["id_ed25519", "id_ecdsa", "id_rsa"]);
    }
}
