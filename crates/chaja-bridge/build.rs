// SPDX-License-Identifier: AGPL-3.0-or-later

//! Build script — pulls OAuth credentials from `.env.local` (workspace
//! root, gitignored) and re-exports them via `cargo:rustc-env=` so the
//! library can read them with `option_env!()` at compile time.
//!
//! Why this exists: OAuth client_id / client_secret pairs need to be
//! baked into release binaries (every desktop OAuth client does this),
//! but they MUST NOT live in source. The `.env.local` workflow gives
//! the maintainer one place to keep secrets locally; CI release builds
//! get them from GitHub Actions secrets via the same env-var names.
//!
//! Builds without `.env.local` work fine — the env vars are simply
//! absent, `option_env!()` returns `None`, and `oauth::config::for_provider`
//! returns an `OAuthNotConfigured` short-circuit. No panic, no error.

use std::path::PathBuf;

/// Env vars exposed to the library via `cargo:rustc-env=`. Add new
/// providers here as their OAuth apps get registered.
const FORWARDED_VARS: &[&str] = &[
    "CHAJA_GITHUB_OAUTH_CLIENT_ID",
    "CHAJA_GITHUB_OAUTH_CLIENT_SECRET",
    "CHAJA_GITLAB_OAUTH_CLIENT_ID",
    "CHAJA_GITLAB_OAUTH_CLIENT_SECRET",
    "CHAJA_BITBUCKET_OAUTH_CLIENT_ID",
    "CHAJA_BITBUCKET_OAUTH_CLIENT_SECRET",
];

fn main() {
    // Walk up from CARGO_MANIFEST_DIR (chaja-bridge) to the workspace
    // root and look for `.env.local` there. CI builds pass values via
    // real env vars and never have a .env.local file — that path is
    // also fine; dotenvy::from_filename is best-effort.
    if let Some(workspace_root) = workspace_root() {
        let env_path = workspace_root.join(".env.local");
        if env_path.exists() {
            // Don't override real env vars when present (CI case).
            let _ = dotenvy::from_path(&env_path);
            println!("cargo:rerun-if-changed={}", env_path.display());
        }
    }

    for var in FORWARDED_VARS {
        // Tell cargo to rebuild when any of these change in the
        // ambient environment (CI override path).
        println!("cargo:rerun-if-env-changed={var}");
        if let Ok(value) = std::env::var(var) {
            // `cargo:rustc-env=` makes the value visible to
            // `option_env!()` in the crate's source.
            println!("cargo:rustc-env={var}={value}");
        }
    }
}

/// Climb from `CARGO_MANIFEST_DIR` until we find a directory
/// containing a `Cargo.toml` with `[workspace]`. Returns `None` if
/// nothing matches before hitting the filesystem root — then the
/// caller silently skips `.env.local` lookup.
fn workspace_root() -> Option<PathBuf> {
    let mut current = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").ok()?);
    loop {
        let candidate = current.join("Cargo.toml");
        if candidate.exists() {
            if let Ok(contents) = std::fs::read_to_string(&candidate) {
                if contents.contains("[workspace]") {
                    return Some(current);
                }
            }
        }
        current = current.parent()?.to_path_buf();
    }
}
