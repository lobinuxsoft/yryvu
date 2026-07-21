// SPDX-License-Identifier: AGPL-3.0-or-later

//! Remote operations split by concern:
//!
//! - [`auth_env`] — pre-flight probe of the host credential environment
//!   (SSH agent / credential helper) so the UI can offer a setup path
//!   when a push has no usable credentials (#44).
//! - [`credentials`] — shared SSH agent / credential-helper callback.
//! - [`management`] — add / remove / set_url / list / get_url. The
//!   REMOTE-header context menu surface (#227).
//! - [`push`] — push HEAD, delete remote branches, push and delete
//!   remote tags. Anything that writes to a remote ref via the push wire.
//! - [`ssh_keygen`] — in-app SSH keypair generation + `ssh -T`
//!   connection test for the guided credential flow (#47).
//! - [`sync`] — fetch_one / fetch_prune / pull / force_pull. Anything
//!   that reads from the remote.
//!
//! `credentials` stays private to the module; the callback is reused by
//! `push.rs` and `sync.rs` but isn't part of the public API. Everything
//! else is re-exported flat so `super::remote::add_remote` etc. keep
//! working from the rest of the crate without touching call sites.

pub mod auth_env;
pub(crate) mod credentials;
mod management;
mod push;
pub mod ssh_keygen;
mod sync;

pub use management::{
    add_remote, get_remote_url, list_remotes, list_remotes_detailed, remove_remote, rename_remote,
    set_remote_push_url, set_remote_url, RemoteInfo,
};
pub use push::{delete_remote_branch, delete_tag_remote, push_current_branch, push_tag};
pub use sync::{fetch_prune, force_pull, pull};
