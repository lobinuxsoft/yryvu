// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-provider OAuth endpoint configuration.
//!
//! `client_id` and `client_secret` are baked at build time from
//! `CHAJA_<PROVIDER>_OAUTH_CLIENT_ID` / `..._SECRET` env vars (see
//! `crates/yryvu-bridge/build.rs`). The maintainer keeps real values
//! in `.env.local` (gitignored) for dev; CI release builds get them
//! from GitHub Actions secrets via the same env-var names.
//!
//! When an env var is absent at build time `option_env!()` returns
//! `None`, the corresponding field stays empty / `None`, and
//! `is_configured()` returns false — `begin_oauth_flow` short-circuits
//! with `OAuthNotConfigured`. No panic, no error, no half-broken state.

/// OAuth 2.0 Authorization Code + PKCE configuration for one provider.
///
/// Fields are owned `String` rather than `&'static str` so the same
/// type works for both built-in defaults (`.com` providers) and
/// user-supplied self-hosted instances (GitHub Enterprise, GitLab
/// Self-Managed, etc.) where the URLs include the user's hostname.
#[derive(Debug, Clone)]
pub struct ProviderOAuthConfig {
    /// Authorization endpoint — where the user is redirected to grant
    /// consent. Must be HTTPS.
    pub authorize_url: String,
    /// Token endpoint — where yryvu exchanges the authorization code
    /// for an access token. Must be HTTPS.
    pub token_url: String,
    /// Scopes requested. The provider may grant a superset (`admin:org`
    /// when only `read:org` was asked) — preflight handles the
    /// hierarchy via `scope_satisfies`.
    pub scopes: Vec<&'static str>,
    /// OAuth client ID, baked at build time from
    /// `CHAJA_<PROVIDER>_OAUTH_CLIENT_ID`. Empty when the env var is
    /// unset → `is_configured()` returns false.
    pub client_id: String,
    /// OAuth client secret, baked at build time from
    /// `CHAJA_<PROVIDER>_OAUTH_CLIENT_SECRET`. `None` for providers
    /// that accept PKCE-only flows (future GitHub Apps); `Some` for
    /// traditional OAuth Apps (github.com, GitLab, Bitbucket — all
    /// require the secret in the token exchange even with PKCE).
    pub client_secret: Option<String>,
}

impl ProviderOAuthConfig {
    pub fn is_configured(&self) -> bool {
        !self.client_id.is_empty()
    }
}

// Build-time-baked credentials. `option_env!` reads from `cargo:rustc-env`
// which `build.rs` populates from `.env.local` (dev) or ambient env
// vars (CI). When unset at build time the constant is `None`.
const GITHUB_CLIENT_ID: Option<&str> = option_env!("CHAJA_GITHUB_OAUTH_CLIENT_ID");
const GITHUB_CLIENT_SECRET: Option<&str> = option_env!("CHAJA_GITHUB_OAUTH_CLIENT_SECRET");
const GITLAB_CLIENT_ID: Option<&str> = option_env!("CHAJA_GITLAB_OAUTH_CLIENT_ID");
const GITLAB_CLIENT_SECRET: Option<&str> = option_env!("CHAJA_GITLAB_OAUTH_CLIENT_SECRET");
const BITBUCKET_CLIENT_ID: Option<&str> = option_env!("CHAJA_BITBUCKET_OAUTH_CLIENT_ID");
const BITBUCKET_CLIENT_SECRET: Option<&str> = option_env!("CHAJA_BITBUCKET_OAUTH_CLIENT_SECRET");

fn baked_id(env_value: Option<&str>) -> String {
    env_value.unwrap_or("").to_string()
}

fn baked_secret(env_value: Option<&str>) -> Option<String> {
    env_value.map(|s| s.to_string())
}

/// Default config for a `.com` provider. Self-hosted variants are
/// constructed by the caller from the user's hostname (see the form in
/// `SelfHostedConfiguration` dialog, PR #247).
pub fn for_provider(integration_type: &str) -> Option<ProviderOAuthConfig> {
    match integration_type {
        "github" => Some(ProviderOAuthConfig {
            authorize_url: "https://github.com/login/oauth/authorize".into(),
            token_url: "https://github.com/login/oauth/access_token".into(),
            // PR review surface needs `repo` (private repo PRs) and
            // `read:org` (org-scoped PR access). Matches the preflight
            // required-scope list in `clients/github.rs`.
            scopes: vec!["repo", "read:org"],
            client_id: baked_id(GITHUB_CLIENT_ID),
            client_secret: baked_secret(GITHUB_CLIENT_SECRET),
        }),
        "gitlab" => Some(ProviderOAuthConfig {
            authorize_url: "https://gitlab.com/oauth/authorize".into(),
            token_url: "https://gitlab.com/oauth/token".into(),
            scopes: vec!["api", "read_user", "read_repository"],
            client_id: baked_id(GITLAB_CLIENT_ID),
            client_secret: baked_secret(GITLAB_CLIENT_SECRET),
        }),
        "bitbucket" => Some(ProviderOAuthConfig {
            // Bitbucket doesn't accept `redirect_uri` at authorize time;
            // it takes the value registered with the OAuth consumer.
            // The loopback URL is therefore registered on the consumer
            // page when the user creates the app.
            authorize_url: "https://bitbucket.org/site/oauth2/authorize".into(),
            token_url: "https://bitbucket.org/site/oauth2/access_token".into(),
            scopes: vec!["account", "repository", "pullrequest"],
            client_id: baked_id(BITBUCKET_CLIENT_ID),
            client_secret: baked_secret(BITBUCKET_CLIENT_SECRET),
        }),
        "azure-devops" => Some(ProviderOAuthConfig {
            authorize_url: "https://app.vssps.visualstudio.com/oauth2/authorize".into(),
            token_url: "https://app.vssps.visualstudio.com/oauth2/token".into(),
            // Azure DevOps uses URL-encoded scope identifiers — these
            // are the documented short names that `oauth2` will encode
            // for us.
            scopes: vec!["vso.code", "vso.work", "vso.identity"],
            // Azure / Jira not yet baked — leave empty until the
            // maintainer registers their OAuth apps.
            client_id: String::new(),
            client_secret: None,
        }),
        "jira-cloud" => Some(ProviderOAuthConfig {
            authorize_url: "https://auth.atlassian.com/authorize".into(),
            token_url: "https://auth.atlassian.com/oauth/token".into(),
            scopes: vec!["read:jira-user", "read:jira-work"],
            client_id: String::new(),
            client_secret: None,
        }),
        _ => None,
    }
}
