// SPDX-License-Identifier: AGPL-3.0-or-later

//! Loopback HTTP server for the OAuth Authorization Code redirect.
//!
//! After the user grants consent, the provider redirects the browser
//! to `http://127.0.0.1:<port>/callback?code=…&state=…`. This module
//! binds an ephemeral port on `127.0.0.1`, blocks until the redirect
//! arrives (or the timeout elapses), parses out `code` and `state`,
//! and serves a minimal "you can close this tab" page back to the
//! browser.
//!
//! Sync (not async) intentionally — the server lives for the duration
//! of one OAuth attempt and is invoked from a `spawn_blocking` worker
//! in the Tauri command layer. tiny_http is dependency-light and
//! thread-friendly; switching to an async server would force an extra
//! tokio runtime with no UX benefit.

use std::time::Duration;

use tiny_http::{Response, Server};
use url::Url;

use crate::backend::BackendError;

/// One-shot loopback HTTP listener. Owns the bound port and the
/// `tiny_http::Server`; consumed by [`await_callback`].
pub struct LoopbackServer {
    server: Server,
    port: u16,
}

impl std::fmt::Debug for LoopbackServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoopbackServer")
            .field("port", &self.port)
            .finish_non_exhaustive()
    }
}

impl LoopbackServer {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Loopback URL the provider should redirect to. The path
    /// (`/callback`) is fixed; nothing else listens on the port so the
    /// path is mostly cosmetic, but providers like GitHub require the
    /// pre-registered redirect URI to match exactly.
    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }
}

/// Bind an ephemeral TCP port on `127.0.0.1` and return a one-shot
/// listener. The OS picks the port; reading [`LoopbackServer::port`]
/// reveals which one.
pub fn bind() -> Result<LoopbackServer, BackendError> {
    let server = Server::http("127.0.0.1:0").map_err(|e| BackendError::OAuthExchangeFailed {
        detail: format!("loopback bind failed: {e}"),
    })?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|sa| sa.port())
        .ok_or_else(|| BackendError::OAuthExchangeFailed {
            detail: "loopback bound to a non-IP address".into(),
        })?;
    Ok(LoopbackServer { server, port })
}

/// Parsed OAuth callback parameters from the redirect URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackParams {
    pub code: String,
    pub state: String,
}

/// Block until the provider redirects the browser to the loopback,
/// up to `timeout`. Returns the parsed `code`/`state` on success.
///
/// - Returns [`BackendError::OAuthTimeout`] if no request arrives in
///   the window.
/// - Returns [`BackendError::OAuthCancelled`] if the redirect carries
///   an `error=access_denied` query (user denied consent).
/// - Returns [`BackendError::OAuthExchangeFailed`] for any other
///   `error=` payload from the provider.
pub fn await_callback(
    server: LoopbackServer,
    timeout: Duration,
) -> Result<CallbackParams, BackendError> {
    let LoopbackServer { server, .. } = server;
    let request = server
        .recv_timeout(timeout)
        .map_err(|e| BackendError::OAuthExchangeFailed {
            detail: format!("loopback recv error: {e}"),
        })?
        .ok_or(BackendError::OAuthTimeout)?;

    let path_with_query = request.url().to_string();
    request
        .respond(
            Response::from_string(SUCCESS_HTML).with_header(
                "Content-Type: text/html; charset=utf-8"
                    .parse::<tiny_http::Header>()
                    .unwrap(),
            ),
        )
        .ok();

    parse_callback(&path_with_query)
}

/// Visible to tests + future Tauri-command callers; pure function so
/// the parsing can be exercised without binding a real port.
pub fn parse_callback(path_with_query: &str) -> Result<CallbackParams, BackendError> {
    // tiny_http delivers `/callback?...`; build a synthetic absolute
    // URL so `url::Url` can parse the query for us.
    let synthetic = format!("http://127.0.0.1{path_with_query}");
    let url = Url::parse(&synthetic).map_err(|e| BackendError::OAuthExchangeFailed {
        detail: format!("invalid callback URL: {e}"),
    })?;

    let mut code = None;
    let mut state = None;
    let mut error = None;
    let mut error_description = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            "error_description" => error_description = Some(v.into_owned()),
            _ => {}
        }
    }

    if let Some(err) = error {
        return Err(match err.as_str() {
            "access_denied" => BackendError::OAuthCancelled,
            other => BackendError::OAuthExchangeFailed {
                detail: error_description
                    .map(|d| format!("{other}: {d}"))
                    .unwrap_or(other.to_string()),
            },
        });
    }

    Ok(CallbackParams {
        code: code.ok_or(BackendError::OAuthCancelled)?,
        state: state.ok_or(BackendError::OAuthStateMismatch)?,
    })
}

const SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>chajá — sign-in complete</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; padding: 64px; color: #d8dee9; background: #2e3440; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 14px; color: #a3b3c2; margin: 0; }
  </style>
</head>
<body>
  <h1>Sign-in complete.</h1>
  <p>You can close this tab and return to chajá.</p>
</body>
</html>
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_callback_happy_path() {
        let parsed = parse_callback("/callback?code=abc&state=xyz").unwrap();
        assert_eq!(parsed.code, "abc");
        assert_eq!(parsed.state, "xyz");
    }

    #[test]
    fn parse_callback_url_encoded_values() {
        let parsed =
            parse_callback("/callback?code=a%2Bb&state=s%2F1").expect("decode percent-encoded");
        assert_eq!(parsed.code, "a+b");
        assert_eq!(parsed.state, "s/1");
    }

    #[test]
    fn parse_callback_user_denied() {
        let err = parse_callback("/callback?error=access_denied").unwrap_err();
        assert!(matches!(err, BackendError::OAuthCancelled));
    }

    #[test]
    fn parse_callback_provider_error_with_description() {
        let err =
            parse_callback("/callback?error=invalid_request&error_description=missing%20client")
                .unwrap_err();
        match err {
            BackendError::OAuthExchangeFailed { detail } => {
                assert!(detail.contains("invalid_request"));
                assert!(detail.contains("missing client"));
            }
            other => panic!("expected OAuthExchangeFailed, got {other:?}"),
        }
    }

    #[test]
    fn parse_callback_missing_state_is_state_mismatch() {
        let err = parse_callback("/callback?code=abc").unwrap_err();
        assert!(matches!(err, BackendError::OAuthStateMismatch));
    }

    #[test]
    fn parse_callback_missing_code_is_cancelled() {
        // Some providers redirect with neither code nor error if the
        // user closes the consent page; treat as cancellation.
        let err = parse_callback("/callback?state=xyz").unwrap_err();
        assert!(matches!(err, BackendError::OAuthCancelled));
    }

    #[test]
    fn bind_returns_loopback_port() {
        let server = bind().expect("loopback bind should succeed");
        assert_ne!(server.port(), 0);
        assert_eq!(
            server.redirect_uri(),
            format!("http://127.0.0.1:{}/callback", server.port())
        );
    }
}
