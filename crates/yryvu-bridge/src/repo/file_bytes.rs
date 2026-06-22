// SPDX-License-Identifier: AGPL-3.0-or-later

//! Raw blob bytes for the per-filetype image viewer (#60). Returns the
//! content base64-encoded plus a MIME type so the UI can build a blob
//! URL (revoked on unmount, matching GitKraken's image diff). Shares the
//! `(path, source)` resolution with the text reader via `source_bytes`.

use std::path::Path;

use base64::Engine;
use serde::Serialize;

use crate::backend::BackendError;

use super::file_content::{source_bytes, FileContentSource};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBytes {
    /// Standard-alphabet base64 of the blob. Empty when `missing`.
    pub data_base64: String,
    /// MIME type inferred from the extension; empty when unknown or missing.
    pub mime: String,
    pub size: u64,
    /// `true` when the source has no entry for `path` (e.g. the old side
    /// of an added file). The UI renders the `Merge-NoImage` placeholder.
    pub missing: bool,
}

/// MIME type for the extensions GitKraken routes to the image viewer
/// (research doc 09). Matched case-insensitively; returns `""` for
/// anything else.
fn image_mime(path: &str) -> &'static str {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "ico" => "image/x-icon",
        _ => "",
    }
}

pub fn read_file_bytes(
    repo_path: &Path,
    path: &str,
    source: &FileContentSource,
) -> Result<FileBytes, BackendError> {
    match source_bytes(repo_path, path, source)? {
        Some(bytes) => Ok(FileBytes {
            size: bytes.len() as u64,
            data_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
            mime: image_mime(path).to_string(),
            missing: false,
        }),
        None => Ok(FileBytes {
            data_base64: String::new(),
            mime: String::new(),
            size: 0,
            missing: true,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_by_extension_is_case_insensitive() {
        assert_eq!(image_mime("a/b/logo.PNG"), "image/png");
        assert_eq!(image_mime("icon.svg"), "image/svg+xml");
        assert_eq!(image_mime("photo.jpeg"), "image/jpeg");
        assert_eq!(image_mime("scan.TIF"), "image/tiff");
        assert_eq!(image_mime("favicon.ico"), "image/x-icon");
        assert_eq!(image_mime("notes.txt"), "");
        assert_eq!(image_mime("Makefile"), "");
    }
}
