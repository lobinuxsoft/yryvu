// SPDX-License-Identifier: AGPL-3.0-or-later

//! In-memory registry of OAuth sessions in flight.
//!
//! [`OAuthSession`] owns the bound loopback port and the secret PKCE
//! verifier. The Tauri command layer needs to keep that handle alive
//! between the [`oauth_begin`] call (which builds the authorize URL +
//! opens the browser) and the [`oauth_await`] call (which blocks on
//! the redirect and exchanges the code). This module is the bridge:
//! `oauth_begin` parks the session here under a session id, the
//! frontend persists the id, and `oauth_await` takes it back out.
//!
//! `oauth_cancel` drops the session by id — the bound port is freed
//! when the [`OAuthSession`]'s [`LoopbackServer`] is dropped.
//!
//! [`oauth_begin`]: crate::commands::oauth_begin
//! [`oauth_await`]: crate::commands::oauth_await
//! [`LoopbackServer`]: super::loopback::LoopbackServer

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use super::flow::OAuthSession;

static SESSIONS: LazyLock<Mutex<HashMap<String, OAuthSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Park a session under `session_id`. The id is opaque to the
/// frontend — the only contract is that the same id must be passed
/// back into [`take`] / [`drop_session`].
pub fn insert(session_id: String, session: OAuthSession) {
    let mut guard = SESSIONS.lock().expect("oauth session registry poisoned");
    guard.insert(session_id, session);
}

/// Remove and return the session bound to `session_id`. Used by
/// `oauth_await` to take ownership of the [`OAuthSession`] before
/// blocking on the redirect.
pub fn take(session_id: &str) -> Option<OAuthSession> {
    let mut guard = SESSIONS.lock().expect("oauth session registry poisoned");
    guard.remove(session_id)
}

/// Drop the session bound to `session_id` without consuming it. Used
/// by `oauth_cancel` when the user dismisses the flow before the
/// browser round-trip completes. The bound loopback port is released
/// as the [`OAuthSession`]'s drop runs.
pub fn drop_session(session_id: &str) {
    let mut guard = SESSIONS.lock().expect("oauth session registry poisoned");
    guard.remove(session_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::oauth::config::ProviderOAuthConfig;
    use crate::integrations::oauth::loopback;

    fn dummy_session() -> OAuthSession {
        // Build a session with a real loopback bind but a stub config.
        // The session is never consumed by `await_completion` here —
        // we just need a valid `OAuthSession` instance for registry
        // round-trip tests.
        let server = loopback::bind().expect("loopback bind for test");
        let (_pkce_challenge, pkce_verifier) = oauth2::PkceCodeChallenge::new_random_sha256();
        let csrf_token = oauth2::CsrfToken::new_random();
        let config = ProviderOAuthConfig {
            authorize_url: "https://example.com/authorize".into(),
            token_url: "https://example.com/token".into(),
            scopes: vec![],
            client_id: "test".into(),
            client_secret: None,
        };
        OAuthSession::for_test(server, pkce_verifier, csrf_token, config)
    }

    #[test]
    fn insert_take_round_trips() {
        let id = "round-trip-id".to_string();
        insert(id.clone(), dummy_session());
        let taken = take(&id);
        assert!(taken.is_some(), "session should be present after insert");
        // Second take returns None — registry is one-shot per id.
        assert!(take(&id).is_none());
    }

    #[test]
    fn drop_session_removes_entry() {
        let id = "drop-id".to_string();
        insert(id.clone(), dummy_session());
        drop_session(&id);
        assert!(take(&id).is_none(), "session should be gone after drop");
    }

    #[test]
    fn take_unknown_id_returns_none() {
        assert!(take("never-inserted").is_none());
    }
}
