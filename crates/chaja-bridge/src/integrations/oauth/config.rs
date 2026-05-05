// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-provider OAuth endpoint configuration.
//!
//! `client_id` is left empty in this scaffold sub-PR. The maintainer
//! registers chajá OAuth apps with each provider (github.com,
//! gitlab.com, bitbucket.org, etc.) and bakes the public `client_id`
//! into the provider defaults in a follow-up PR. PKCE makes the
//! `client_id` non-secret — it ships in the binary safely as long as
//! the redirect URI is loopback-only (which we enforce).

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
    /// Token endpoint — where chajá exchanges the authorization code
    /// for an access token. Must be HTTPS.
    pub token_url: String,
    /// Scopes requested. The provider may grant a superset (`admin:org`
    /// when only `read:org` was asked) — preflight handles the
    /// hierarchy via `scope_satisfies`.
    pub scopes: Vec<&'static str>,
    /// OAuth client ID, baked at build time (registered with the
    /// provider). Empty in this scaffold — `begin_oauth_flow` returns
    /// `OAuthNotConfigured` until a real ID lands.
    pub client_id: String,
}

impl ProviderOAuthConfig {
    pub fn is_configured(&self) -> bool {
        !self.client_id.is_empty()
    }
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
            client_id: String::new(),
        }),
        "gitlab" => Some(ProviderOAuthConfig {
            authorize_url: "https://gitlab.com/oauth/authorize".into(),
            token_url: "https://gitlab.com/oauth/token".into(),
            scopes: vec!["api", "read_user", "read_repository"],
            client_id: String::new(),
        }),
        "bitbucket" => Some(ProviderOAuthConfig {
            // Bitbucket doesn't accept `redirect_uri` at authorize time;
            // it takes the value registered with the OAuth consumer.
            // The loopback URL is therefore registered on the consumer
            // page when the user creates the app.
            authorize_url: "https://bitbucket.org/site/oauth2/authorize".into(),
            token_url: "https://bitbucket.org/site/oauth2/access_token".into(),
            scopes: vec!["account", "repository", "pullrequest"],
            client_id: String::new(),
        }),
        "azure-devops" => Some(ProviderOAuthConfig {
            authorize_url: "https://app.vssps.visualstudio.com/oauth2/authorize".into(),
            token_url: "https://app.vssps.visualstudio.com/oauth2/token".into(),
            // Azure DevOps uses URL-encoded scope identifiers — these
            // are the documented short names that `oauth2` will encode
            // for us.
            scopes: vec!["vso.code", "vso.work", "vso.identity"],
            client_id: String::new(),
        }),
        "jira-cloud" => Some(ProviderOAuthConfig {
            authorize_url: "https://auth.atlassian.com/authorize".into(),
            token_url: "https://auth.atlassian.com/oauth/token".into(),
            scopes: vec!["read:jira-user", "read:jira-work"],
            client_id: String::new(),
        }),
        _ => None,
    }
}
