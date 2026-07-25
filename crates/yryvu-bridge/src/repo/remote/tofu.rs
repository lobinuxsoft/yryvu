// SPDX-License-Identifier: AGPL-3.0-or-later

//! Trust-On-First-Use round-trip for unknown SSH hosts (#508).
//!
//! The git2 `certificate_check` callback runs inside a `spawn_blocking`
//! worker. When [`known_hosts::verify`] reports a host we have never
//! seen, [`request_trust`] emits an `ssh-tofu-prompt` event to the
//! frontend and **blocks the worker** on a channel until the user
//! confirms or cancels — the same shape as the OAuth loopback wait. The
//! Tauri command layer calls [`resolve`] with the user's decision, which
//! unblocks the worker.
//!
//! Security invariants:
//! - Only a genuinely unknown host reaches here. A changed or revoked key
//!   is rejected upstream in [`credentials`](super::credentials) and
//!   never prompts.
//! - No decision (timeout, closed window, missing UI) resolves to
//!   **refuse**, so the connection aborts rather than trusting blindly.
//! - On accept, the *exact* key that was shown is appended to
//!   `known_hosts`, so the next connection matches those bytes — a MITM
//!   answering a later handshake with a different key would be rejected.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::known_hosts;

/// Event name the frontend listens on to raise the trust prompt.
pub const SSH_TOFU_PROMPT_EVENT: &str = "ssh-tofu-prompt";

/// How long a blocked fetch waits for the user before giving up and
/// refusing. Generous — the worker is a blocking-pool thread, not an
/// async task — but bounded so a dismissed window can't pin it forever.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

/// App handle used to emit the prompt event. Set once in the Tauri
/// `setup` hook. Absent in headless contexts (tests, CLI) — then
/// [`request_trust`] refuses, which is the safe default.
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Sessions blocked in [`request_trust`], keyed by session id, each
/// holding the sender the resolving command signals.
static PENDING: LazyLock<Mutex<HashMap<u64, Sender<bool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Payload delivered to the frontend. The id is opaque; the only
/// contract is it comes back into [`resolve`].
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TofuPrompt {
    session_id: String,
    host: String,
    fingerprint: String,
}

/// Register the app handle so the callback can raise the prompt. Called
/// once from the Tauri `setup` hook.
pub fn init_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// Ask the user whether to trust a first-contact host, blocking until
/// they answer (or the timeout elapses). On accept, the key is appended
/// to `~/.ssh/known_hosts` before returning `true`.
///
/// Returns `false` — refuse — for any non-acceptance: an explicit
/// cancel, a timeout, a closed channel, or no UI to prompt with.
pub fn request_trust(host: &str, key_type: &str, key_b64: &str, fingerprint: &str) -> bool {
    let Some(app) = APP_HANDLE.get() else {
        // No UI wired (headless / tests): cannot prompt, so refuse.
        return false;
    };

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    PENDING
        .lock()
        .expect("tofu registry poisoned")
        .insert(id, tx);

    let emitted = app.emit(
        SSH_TOFU_PROMPT_EVENT,
        TofuPrompt {
            session_id: id.to_string(),
            host: host.to_string(),
            fingerprint: fingerprint.to_string(),
        },
    );
    if emitted.is_err() {
        PENDING.lock().expect("tofu registry poisoned").remove(&id);
        return false;
    }

    // Block the worker until the command signals, or the timeout hits.
    let decision = rx.recv_timeout(PROMPT_TIMEOUT).unwrap_or(false);
    // Drop our slot: a no-op if `resolve` already took it, cleanup on
    // timeout otherwise.
    PENDING.lock().expect("tofu registry poisoned").remove(&id);

    if !decision {
        return false;
    }

    // Persist the exact key the user approved. A write failure still lets
    // this connection proceed — the user validated the fingerprint — it
    // only means the next connection prompts again.
    if let Err(e) = known_hosts::append_trusted_host(host, key_type, key_b64) {
        tracing::warn!("trusted {host} for this session but could not persist to known_hosts: {e}");
    }
    true
}

/// Deliver the user's decision for a pending prompt. Called from the
/// `ssh_tofu_resolve` command. Unknown or already-resolved ids are
/// ignored (the worker may have timed out and moved on).
pub fn resolve(session_id: &str, accept: bool) {
    let Ok(id) = session_id.parse::<u64>() else {
        return;
    };
    let sender = PENDING.lock().expect("tofu registry poisoned").remove(&id);
    if let Some(tx) = sender {
        // The receiver may already be gone (timeout); dropping the send
        // is fine.
        let _ = tx.send(accept);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_unknown_session_is_a_noop() {
        // Must not panic on an id that was never registered.
        resolve("999999", true);
        resolve("not-a-number", true);
    }

    #[test]
    fn request_trust_without_app_handle_refuses() {
        // No APP_HANDLE set in the unit-test binary → refuse, never
        // trust blindly.
        assert!(!request_trust(
            "fresh.example.com",
            "ssh-ed25519",
            "AAAAC3NzaC1lZDI1NTE5AAAAIAWkjI6XT2SZh3xNk5NhisA3o3sGzWR+VAKMSqHtI0aY",
            "SHA256:abc"
        ));
    }
}
