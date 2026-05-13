// SPDX-License-Identifier: AGPL-3.0-or-later

//! Metadata loaders — parse `theme.toml` from a built-in folder or a
//! custom-dir entry into [`ThemeMetadata`]. Used by `list` to populate
//! [`ThemeEntry`] and by `duplicate` when reading the source theme's
//! current id/name.

use std::path::Path;

use crate::themes::schema::{self, ThemeMetadata};

use super::{io_err, read_built_in_utf8, LoadError, FILE_THEME_TOML};

pub(super) fn built_in_metadata(folder: &str) -> Result<ThemeMetadata, LoadError> {
    let src = read_built_in_utf8(folder, FILE_THEME_TOML)?;
    schema::parse(src, folder).map_err(|e| LoadError::Schema {
        id: folder.to_string(),
        source: e,
    })
}

pub(super) fn custom_metadata(dir: &Path, folder: &str) -> Result<ThemeMetadata, LoadError> {
    let toml_path = dir.join(folder).join(FILE_THEME_TOML);
    let src = std::fs::read_to_string(&toml_path).map_err(|e| io_err(folder, e))?;
    schema::parse(&src, folder).map_err(|e| LoadError::Schema {
        id: folder.to_string(),
        source: e,
    })
}

pub(super) fn custom_exists(dir: &Path, id: &str) -> bool {
    dir.join(id).join(FILE_THEME_TOML).is_file()
}
