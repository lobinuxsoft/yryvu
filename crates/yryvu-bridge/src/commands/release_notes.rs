// SPDX-License-Identifier: AGPL-3.0-or-later

//! Release notes (#208 / #135). Reads `CHANGELOG.md` from disk and
//! returns the contents, or `None` when the file doesn't exist yet
//! (pre-first-release builds — release-please generates the changelog
//! on the first merged conventional `feat:` or `fix:` commit reaching
//! `main`).
//!
//! # Path resolution
//!
//! `CHANGELOG.md` lives at the workspace root, not inside the Tauri
//! crate. Two resolution paths cover both runtime modes:
//!
//! 1. **Prod bundle**: `tauri.conf.json` `bundle.resources` lists
//!    `"../../../CHANGELOG.md"` so the file ships alongside the binary.
//!    `app.path().resource_dir()` resolves to the bundled directory.
//!
//! 2. **Dev mode**: `cargo run` puts the cwd at `apps/yryvu-app/src-tauri/`.
//!    Walk parent directories until `CHANGELOG.md` shows up — handles
//!    both monorepo and standalone-clone layouts.
//!
//! Both paths return `None` cleanly when the file doesn't exist; the
//! frontend renders a "no release notes yet" empty state in that case.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Result of a changelog read. Discriminated on `present` so the
/// frontend can branch on existence without parsing the string. Empty
/// strings are valid markdown (an empty CHANGELOG is a real edge case
/// after a `chore: housekeeping` commit) — `present: false` means the
/// file isn't there at all.
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogContents {
    pub present: bool,
    pub markdown: String,
}

#[tauri::command]
pub async fn read_changelog(app: AppHandle) -> Result<ChangelogContents, String> {
    let path = match resolve_changelog_path(&app) {
        Some(p) => p,
        None => {
            return Ok(ChangelogContents {
                present: false,
                markdown: String::new(),
            });
        }
    };
    let markdown = std::fs::read_to_string(&path)
        .map_err(|e| format!("read CHANGELOG.md at {}: {}", path.display(), e))?;
    Ok(ChangelogContents {
        present: true,
        markdown,
    })
}

fn resolve_changelog_path(app: &AppHandle) -> Option<PathBuf> {
    // Prod bundle path first — declared in tauri.conf.json bundle.resources.
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("CHANGELOG.md");
        if p.exists() {
            return Some(p);
        }
    }
    // Dev mode: ascend from cwd until we hit it. cargo run starts the
    // process in `apps/yryvu-app/src-tauri/`; the workspace root is
    // 3 ancestors up. Walking guards against the user invoking the
    // binary from elsewhere.
    if let Ok(cwd) = std::env::current_dir() {
        for parent in cwd.ancestors() {
            let p = parent.join("CHANGELOG.md");
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}
