// SPDX-License-Identifier: AGPL-3.0-or-later

//! OpenSSH `known_hosts` verification for the git2 `certificate_check`
//! callback (#508).
//!
//! ## Why this exists
//!
//! git2-rs drops libgit2's `valid` bit (`remote_callbacks.rs`, the C
//! `valid` param is bound to `_valid`), so a registered
//! `certificate_check` cannot learn whether libgit2's own known_hosts
//! check passed. To tell a **new host** (prompt, Trust-On-First-Use)
//! apart from a **changed key** (reject — possible MITM) we must
//! re-check `known_hosts` ourselves. Hand-rolling that parse (hashed
//! `|1|` HMAC-SHA1 entries, `@revoked`, `@cert-authority`, glob and
//! negated host patterns) is exactly where a subtle bug turns TOFU into
//! blind-accept, so the decision core here is ported verbatim from
//! Cargo's `src/sources/git/known_hosts.rs` (MIT/Apache), including its
//! test suite. The only edits strip Cargo's config system: yryvu reads
//! OpenSSH files from disk and the bundled keys, nothing else.
//!
//! ## Module layout
//!
//! - [`parse`] — reads `known_hosts` lines and matches a host against an
//!   entry's patterns (globs, negation, hashed `|1|`).
//! - [`bundled`] — GitHub's hard-coded keys and revocations.
//! - [`check`] — the decision core (trusted / unknown / changed /
//!   revoked / CA-only) and the public [`verify`] entry point.
//! - [`append`] — writes a newly-trusted key back to `known_hosts`.
//!
//! ## Limitations (same as Cargo)
//!
//! Reads OpenSSH `known_hosts` from the well-known locations only. Does
//! not honour `~/.ssh/config` directives that move those files
//! (`UserKnownHostsFile`, `GlobalKnownHostsFile`, `KnownHostsCommand`),
//! nor `CheckHostIP` / `VerifyHostKeyDNS`. The port passed to the
//! callback is unavailable, so a `[host]:port` entry for a non-22 remote
//! is treated as a new host (re-prompt) rather than matched.

mod append;
mod bundled;
mod check;
mod parse;

pub use append::append_trusted_host;
pub use check::{verify, HostKeyVerdict};
