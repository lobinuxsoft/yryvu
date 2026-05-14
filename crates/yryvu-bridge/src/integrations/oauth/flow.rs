// SPDX-License-Identifier: AGPL-3.0-or-later

//! OAuth Authorization Code + PKCE flow driver.
//!
//! Two phases:
//!
//! 1. [`begin`] — bind a loopback port, generate PKCE verifier +
//!    challenge + CSRF token, build the provider's `authorize_url`.
//!    Returns an [`OAuthSession`] handle that the caller stores while
//!    the user grants consent in their browser.
//! 2. [`await_completion`] — wait for the provider's redirect on the
//!    loopback, verify the CSRF token matches, exchange the
//!    authorization code for an access token.
//!
//! The `OAuthSession` type is intentionally opaque: it owns the bound
//! server + the secret PKCE verifier, and consuming it is the only way
//! to drive the exchange. This sub-PR doesn't yet store sessions in a
//! global registry — that lands with the Tauri command layer.

use std::time::Duration;

use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointNotSet, EndpointSet,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse, TokenUrl,
};

use crate::backend::BackendError;

use super::config::{self, ProviderOAuthConfig};
use super::loopback::{self, CallbackParams, LoopbackServer};

/// OAuth flow defaults to a 5-minute window — long enough for the
/// user to authenticate (incl. 2FA / SSO redirects), short enough that
/// an abandoned flow doesn't pin the loopback port indefinitely.
pub const DEFAULT_FLOW_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Fully-configured OAuth client (auth + token + redirect URLs all
/// set). The remaining `EndpointNotSet` slots are introspection +
/// device-auth, which chajá doesn't use.
type ConfiguredClient = BasicClient<
    EndpointSet,    // has auth_uri
    EndpointNotSet, // device_authorization_url
    EndpointNotSet, // introspection_url
    EndpointNotSet, // revocation_url
    EndpointSet,    // has token_uri
>;

/// Owns everything needed to drive one OAuth attempt to completion:
/// the bound loopback server, the PKCE verifier, the CSRF token, and
/// a snapshot of the provider config. Move into [`await_completion`]
/// to consume.
#[derive(Debug)]
pub struct OAuthSession {
    server: LoopbackServer,
    pkce_verifier: PkceCodeVerifier,
    csrf_token: CsrfToken,
    config: ProviderOAuthConfig,
}

impl OAuthSession {
    /// Loopback port the provider should redirect to. Useful for
    /// surfaces that need to display the redirect URL the user
    /// registered (self-hosted setups, debug overlays).
    pub fn redirect_port(&self) -> u16 {
        self.server.port()
    }

    /// Constructor for tests in sibling modules (e.g. the registry
    /// in `state.rs`). Not part of the public API — gated to `cfg(test)`
    /// callers via a `pub(super)` cousin would have been ideal but
    /// `state.rs` is a sibling, not a child, so it's `pub`-with-a-lock.
    #[cfg(test)]
    pub fn for_test(
        server: LoopbackServer,
        pkce_verifier: PkceCodeVerifier,
        csrf_token: CsrfToken,
        config: ProviderOAuthConfig,
    ) -> Self {
        OAuthSession {
            server,
            pkce_verifier,
            csrf_token,
            config,
        }
    }
}

/// Phase 1: build the authorize URL for `provider` and return an
/// [`OAuthSession`] handle. Caller is expected to open the URL in the
/// user's browser (e.g. via `tauri-plugin-opener`).
///
/// Returns [`BackendError::OAuthNotConfigured`] if the provider's
/// `client_id` is empty (i.e. the maintainer hasn't registered the
/// OAuth app yet — true for every provider in this scaffold).
pub fn begin(provider: &str) -> Result<(OAuthSession, String), BackendError> {
    let config = config::for_provider(provider).ok_or(BackendError::OAuthNotConfigured)?;
    if !config.is_configured() {
        return Err(BackendError::OAuthNotConfigured);
    }

    let server = loopback::bind()?;
    let redirect_uri = server.redirect_uri();

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let csrf_token = CsrfToken::new_random();

    let authorize_url =
        build_authorize_url(&config, &redirect_uri, pkce_challenge, csrf_token.clone())?;

    Ok((
        OAuthSession {
            server,
            pkce_verifier,
            csrf_token,
            config,
        },
        authorize_url,
    ))
}

/// Phase 2: wait until the provider redirects to our loopback or the
/// timeout elapses, then exchange the authorization code for an
/// access token.
///
/// Consumes the [`OAuthSession`] — replays are explicitly prevented.
///
/// The loopback recv blocks for the duration of the OAuth window
/// (default 5 minutes), so it runs on a dedicated tokio blocking
/// thread to avoid pinning a runtime worker.
pub async fn await_completion(
    session: OAuthSession,
    timeout: Duration,
) -> Result<String, BackendError> {
    let OAuthSession {
        server,
        pkce_verifier,
        csrf_token,
        config,
    } = session;
    let redirect_uri = server.redirect_uri();
    let csrf_secret = csrf_token.secret().to_string();

    let CallbackParams { code, state } =
        tokio::task::spawn_blocking(move || loopback::await_callback(server, timeout))
            .await
            .map_err(|e| BackendError::OAuthExchangeFailed {
                detail: format!("loopback worker panicked: {e}"),
            })??;

    // Constant-time would be nicer here, but the CSRF token is a
    // 128-bit random string — string-equality is not the side-channel
    // the threat model worries about.
    if state != csrf_secret {
        return Err(BackendError::OAuthStateMismatch);
    }

    let client = build_client(&config, &redirect_uri)?;
    let http_client =
        reqwest::Client::builder()
            .build()
            .map_err(|e| BackendError::NetworkError {
                detail: format!("reqwest builder failed: {e}"),
            })?;

    let token = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http_client)
        .await
        .map_err(|e| BackendError::OAuthExchangeFailed {
            detail: e.to_string(),
        })?;

    Ok(token.access_token().secret().to_string())
}

fn build_client(
    config: &ProviderOAuthConfig,
    redirect_uri: &str,
) -> Result<ConfiguredClient, BackendError> {
    let auth_url = AuthUrl::new(config.authorize_url.clone()).map_err(|e| {
        BackendError::OAuthExchangeFailed {
            detail: format!("bad authorize_url: {e}"),
        }
    })?;
    let token_url =
        TokenUrl::new(config.token_url.clone()).map_err(|e| BackendError::OAuthExchangeFailed {
            detail: format!("bad token_url: {e}"),
        })?;
    let redirect = RedirectUrl::new(redirect_uri.to_string()).map_err(|e| {
        BackendError::OAuthExchangeFailed {
            detail: format!("bad redirect: {e}"),
        }
    })?;

    let mut client = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_auth_uri(auth_url)
        .set_token_uri(token_url)
        .set_redirect_uri(redirect);
    if let Some(secret) = &config.client_secret {
        // GitHub OAuth Apps + GitLab + Bitbucket all require the
        // client secret in the token exchange even with PKCE. Future
        // GitHub Apps (PKCE-only) leave this `None` and skip the
        // assignment.
        client = client.set_client_secret(ClientSecret::new(secret.clone()));
    }
    Ok(client)
}

fn build_authorize_url(
    config: &ProviderOAuthConfig,
    redirect_uri: &str,
    challenge: PkceCodeChallenge,
    csrf: CsrfToken,
) -> Result<String, BackendError> {
    let client = build_client(config, redirect_uri)?;
    let mut req = client.authorize_url(move || csrf.clone());
    for scope in &config.scopes {
        req = req.add_scope(Scope::new((*scope).to_string()));
    }
    let (url, _csrf) = req.set_pkce_challenge(challenge).url();
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn begin_unknown_provider_returns_not_configured() {
        let err = begin("not-a-real-provider").unwrap_err();
        assert!(matches!(err, BackendError::OAuthNotConfigured));
    }

    #[test]
    fn begin_provider_without_baked_creds_returns_not_configured() {
        // azure-devops and jira-cloud are hardcoded with empty
        // client_id (no `option_env!` bake) — those always
        // short-circuit, regardless of `.env.local` contents on the
        // build host. github / gitlab / bitbucket may or may not be
        // baked depending on the maintainer's `.env.local`, so we
        // can't assert anything universal about them here.
        for provider in ["azure-devops", "jira-cloud"] {
            let err = begin(provider).unwrap_err();
            assert!(
                matches!(err, BackendError::OAuthNotConfigured),
                "provider {provider}: expected OAuthNotConfigured"
            );
        }
    }

    #[test]
    fn build_authorize_url_includes_pkce_and_state() {
        // Pretend we have a real client_id so we can drive the URL
        // builder. This is the same code path `begin` runs after the
        // not-configured guard.
        let mut cfg = config::for_provider("github").unwrap();
        cfg.client_id = "Iv1.test".into();

        let (challenge, _verifier) = PkceCodeChallenge::new_random_sha256();
        let csrf = CsrfToken::new("test-csrf-state".into());
        let url = build_authorize_url(&cfg, "http://127.0.0.1:12345/callback", challenge, csrf)
            .expect("authorize URL should build with a non-empty client_id");

        assert!(url.starts_with("https://github.com/login/oauth/authorize?"));
        assert!(url.contains("client_id=Iv1.test"));
        assert!(url.contains("code_challenge=")); // PKCE present
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=test-csrf-state"));
        assert!(url.contains("scope=repo"));
        assert!(url.contains("read%3Aorg")); // url-encoded `read:org`
    }
}
