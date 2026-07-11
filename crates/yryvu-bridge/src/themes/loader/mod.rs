// SPDX-License-Identifier: AGPL-3.0-or-later

//! Theme loader: scans built-ins (compile-time embedded) and custom
//! (filesystem at runtime). Custom themes shadow built-ins by id.
//!
//! Built-ins live under `crates/yryvu-bridge/resources/themes/<id>/` and
//! are embedded with the `include_dir!` macro — no filesystem access at
//! runtime. Custom themes live under `<app-config>/themes/<id>/` and
//! are scanned on every `list_themes` call.
//!
//! A theme folder MUST contain `theme.toml` and `tokens.css`.
//! `personality.css` is optional.
//!
//! Split from a 515 LoC monolith in #351. The public surface
//! (`yryvu_bridge::themes::loader::list_themes` etc.) stays unchanged —
//! sub-modules own one concern each and `mod.rs` re-exports.

use std::path::{Path, PathBuf};

use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::themes::schema::{SchemaError, ThemeMetadata};

mod css;
mod duplicate;
mod list;
mod metadata;

pub use css::get_theme_css;
pub use duplicate::create_from_template;
pub use list::list_themes;

pub(super) static BUILT_INS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/resources/themes");

pub(super) const FILE_THEME_TOML: &str = "theme.toml";
pub(super) const FILE_TOKENS_CSS: &str = "tokens.css";
pub(super) const FILE_PERSONALITY_CSS: &str = "personality.css";

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("theme `{id}` not found")]
    NotFound { id: String },
    #[error("theme `{id}` is missing required file `{file}`")]
    MissingFile { id: String, file: String },
    #[error("theme `{id}` schema error")]
    Schema {
        id: String,
        #[source]
        source: SchemaError,
    },
    #[error("filesystem I/O for theme `{id}`")]
    Io {
        id: String,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid utf-8 in theme `{id}` file `{file}`")]
    InvalidUtf8 { id: String, file: String },
}

/// Theme entry returned to the frontend. `built_in` lets the UI badge
/// "(Custom)" without a second round-trip.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEntry {
    #[serde(flatten)]
    pub metadata: ThemeMetadata,
    pub built_in: bool,
}

/// CSS payload returned by `get_theme_css`, one string per injectable
/// layer. `icons` and `personality` are empty when the theme declares no
/// such layer (the flat legacy layout never has an icons layer).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCss {
    pub tokens: String,
    #[serde(default)]
    pub icons: String,
    pub personality: String,
}

/// Resolve `<config>/themes/` for a Tauri-style app config dir.
pub fn themes_dir(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join("themes")
}

/// Read a UTF-8 file from the embedded built-ins, returning the static
/// slice. Shared between `css` (loads tokens / personality) and
/// `duplicate` (reads source `theme.toml` for the copy).
pub(super) fn read_built_in_utf8(id: &str, file: &str) -> Result<&'static str, LoadError> {
    BUILT_INS
        .get_file(format!("{id}/{file}"))
        .ok_or_else(|| LoadError::MissingFile {
            id: id.to_string(),
            file: file.to_string(),
        })?
        .contents_utf8()
        .ok_or_else(|| LoadError::InvalidUtf8 {
            id: id.to_string(),
            file: file.to_string(),
        })
}

/// Wrap a `std::io::Error` into [`LoadError::Io`] without losing the
/// theme id context.
pub(super) fn io_err(id: &str, source: std::io::Error) -> LoadError {
    LoadError::Io {
        id: id.to_string(),
        source,
    }
}

#[cfg(test)]
pub(super) fn write_theme_fixture(dir: &Path, id: &str, scheme: &str, tokens: &str) {
    let theme = dir.join(id);
    std::fs::create_dir_all(&theme).unwrap();
    std::fs::write(
        theme.join(FILE_THEME_TOML),
        format!("name = \"{id}\"\nid = \"{id}\"\nscheme = \"{scheme}\"\n"),
    )
    .unwrap();
    std::fs::write(theme.join(FILE_TOKENS_CSS), tokens).unwrap();
}
