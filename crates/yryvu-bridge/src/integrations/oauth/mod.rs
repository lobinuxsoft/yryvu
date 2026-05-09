// SPDX-License-Identifier: AGPL-3.0-or-later

//! OAuth 2.0 Authorization Code + PKCE flow scaffold (sub of #46).
//!
//! Pieces:
//!
//! - [`config`] — per-provider endpoint URLs + scope sets + the
//!   `client_id` slot the maintainer fills after registering OAuth
//!   apps with each provider.
//! - [`loopback`] — ephemeral HTTP server on `127.0.0.1` that receives
//!   the post-consent redirect from the provider.
//! - [`flow`] — the two-phase driver: `begin` builds the authorize URL
//!   and stages a session, `await_completion` waits for the redirect
//!   and exchanges the code for an access token.
//!
//! Why local OAuth (not GK's auth proxy): chajá registers its own
//! OAuth apps per provider and does the PKCE exchange directly. PKCE
//! is mandatory in 2025 OAuth — the `client_id` is non-secret as long
//! as the redirect URI is loopback, which we enforce.
//!
//! - [`state`] — in-memory registry of sessions in flight, keyed by
//!   an opaque session id the frontend persists between `oauth_begin`
//!   and `oauth_await`.

pub mod config;
pub mod flow;
pub mod loopback;
pub mod state;

pub use config::{for_provider, ProviderOAuthConfig};
pub use flow::{await_completion, begin, OAuthSession, DEFAULT_FLOW_TIMEOUT};
pub use loopback::{CallbackParams, LoopbackServer};
