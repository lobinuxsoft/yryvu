// SPDX-License-Identifier: AGPL-3.0-or-later

use std::sync::Mutex;

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
            let user = username_from_url.unwrap_or("git");
            if let Ok(cred) = git2::Cred::ssh_key_from_agent(user) {
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
            "no credentials available (tried integration token, SSH agent, git credential helper, default)",
        ))
    });
    callbacks
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
}
