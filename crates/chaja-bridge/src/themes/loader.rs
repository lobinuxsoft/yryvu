// SPDX-License-Identifier: AGPL-3.0-or-later

//! Theme loader: scans built-ins (compile-time embedded) and custom
//! (filesystem at runtime). Custom themes shadow built-ins by id.
//!
//! Built-ins live under `crates/chaja-bridge/resources/themes/<id>/` and
//! are embedded with the `include_dir!` macro — no filesystem access at
//! runtime. Custom themes live under `<app-config>/themes/<id>/` and
//! are scanned on every `list_themes` call.
//!
//! A theme folder MUST contain `theme.toml` and `tokens.css`.
//! `personality.css` is optional.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use include_dir::{Dir, include_dir};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::schema::{self, SchemaError, ThemeMetadata};

static BUILT_INS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/resources/themes");

const FILE_THEME_TOML: &str = "theme.toml";
const FILE_TOKENS_CSS: &str = "tokens.css";
const FILE_PERSONALITY_CSS: &str = "personality.css";

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

/// CSS payload returned by `get_theme_css`. `personality` is empty
/// when the theme has no `personality.css` file.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCss {
    pub tokens: String,
    pub personality: String,
}

/// List every theme available. Custom themes shadow built-ins by id —
/// when both exist, only the custom version appears. Returned list is
/// sorted by id (BTreeMap iteration).
pub fn list_themes(custom_dir: &Path) -> Vec<ThemeEntry> {
    let mut by_id: BTreeMap<String, ThemeEntry> = BTreeMap::new();

    for folder in built_in_folders() {
        if let Ok(meta) = built_in_metadata(&folder) {
            by_id.insert(
                folder.clone(),
                ThemeEntry { metadata: meta, built_in: true },
            );
        }
    }

    if custom_dir.is_dir() {
        if let Ok(read_dir) = std::fs::read_dir(custom_dir) {
            for entry in read_dir.flatten() {
                let folder = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if !is_dir {
                    continue;
                }
                if let Ok(meta) = custom_metadata(custom_dir, &folder) {
                    by_id.insert(
                        folder,
                        ThemeEntry { metadata: meta, built_in: false },
                    );
                }
            }
        }
    }

    by_id.into_values().collect()
}

/// Fetch CSS for a theme by id. Custom shadows built-in.
pub fn get_theme_css(id: &str, custom_dir: &Path) -> Result<ThemeCss, LoadError> {
    if custom_exists(custom_dir, id) {
        load_custom_css(custom_dir, id)
    } else if BUILT_INS.get_dir(id).is_some() {
        load_built_in_css(id)
    } else {
        Err(LoadError::NotFound { id: id.to_string() })
    }
}

/// Copy a built-in theme to `<custom_dir>/<new_id>/`, rewriting `id` in
/// `theme.toml` and the `:root[data-theme="…"]` selector in tokens.css.
/// Returns the generated `new_id` (e.g. `a-default-copy`,
/// `a-default-copy-2`, …).
pub fn create_from_template(
    builtin_id: &str,
    custom_dir: &Path,
) -> Result<String, LoadError> {
    if BUILT_INS.get_dir(builtin_id).is_none() {
        return Err(LoadError::NotFound { id: builtin_id.to_string() });
    }

    let new_id = unique_id(custom_dir, builtin_id);
    let dest = custom_dir.join(&new_id);
    std::fs::create_dir_all(&dest).map_err(|e| io_err(&new_id, e))?;

    let toml_src = read_built_in_utf8(builtin_id, FILE_THEME_TOML)?;
    let toml_rewritten = rewrite_toml_id(toml_src, &new_id)
        .map_err(|e| LoadError::Schema { id: new_id.clone(), source: e })?;
    std::fs::write(dest.join(FILE_THEME_TOML), toml_rewritten)
        .map_err(|e| io_err(&new_id, e))?;

    let tokens_src = read_built_in_utf8(builtin_id, FILE_TOKENS_CSS)?;
    let tokens_rewritten = tokens_src.replace(
        &format!(":root[data-theme=\"{builtin_id}\"]"),
        &format!(":root[data-theme=\"{new_id}\"]"),
    );
    std::fs::write(dest.join(FILE_TOKENS_CSS), tokens_rewritten)
        .map_err(|e| io_err(&new_id, e))?;

    if let Some(p) = BUILT_INS
        .get_file(format!("{builtin_id}/{FILE_PERSONALITY_CSS}"))
        .and_then(|f| f.contents_utf8())
    {
        std::fs::write(dest.join(FILE_PERSONALITY_CSS), p)
            .map_err(|e| io_err(&new_id, e))?;
    }

    Ok(new_id)
}

/// Resolve `<config>/themes/` for a Tauri-style app config dir.
pub fn themes_dir(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join("themes")
}

fn built_in_folders() -> Vec<String> {
    BUILT_INS
        .dirs()
        .filter_map(|d| d.path().file_name().and_then(|s| s.to_str()).map(String::from))
        .collect()
}

fn built_in_metadata(folder: &str) -> Result<ThemeMetadata, LoadError> {
    let src = read_built_in_utf8(folder, FILE_THEME_TOML)?;
    schema::parse(src, folder).map_err(|e| LoadError::Schema {
        id: folder.to_string(),
        source: e,
    })
}

fn custom_metadata(dir: &Path, folder: &str) -> Result<ThemeMetadata, LoadError> {
    let toml_path = dir.join(folder).join(FILE_THEME_TOML);
    let src = std::fs::read_to_string(&toml_path).map_err(|e| io_err(folder, e))?;
    schema::parse(&src, folder).map_err(|e| LoadError::Schema {
        id: folder.to_string(),
        source: e,
    })
}

fn custom_exists(dir: &Path, id: &str) -> bool {
    dir.join(id).join(FILE_THEME_TOML).is_file()
}

fn load_built_in_css(id: &str) -> Result<ThemeCss, LoadError> {
    let tokens = read_built_in_utf8(id, FILE_TOKENS_CSS)?.to_string();
    let personality = BUILT_INS
        .get_file(format!("{id}/{FILE_PERSONALITY_CSS}"))
        .and_then(|f| f.contents_utf8())
        .map(String::from)
        .unwrap_or_default();
    Ok(ThemeCss { tokens, personality })
}

fn load_custom_css(dir: &Path, id: &str) -> Result<ThemeCss, LoadError> {
    let theme_dir = dir.join(id);
    let tokens = std::fs::read_to_string(theme_dir.join(FILE_TOKENS_CSS))
        .map_err(|e| io_err(id, e))?;
    let personality = std::fs::read_to_string(theme_dir.join(FILE_PERSONALITY_CSS))
        .unwrap_or_default();
    Ok(ThemeCss { tokens, personality })
}

fn read_built_in_utf8(id: &str, file: &str) -> Result<&'static str, LoadError> {
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

fn unique_id(custom_dir: &Path, base: &str) -> String {
    let candidate = format!("{base}-copy");
    if !custom_dir.join(&candidate).exists() {
        return candidate;
    }
    let mut n = 2;
    loop {
        let c = format!("{base}-copy-{n}");
        if !custom_dir.join(&c).exists() {
            return c;
        }
        n += 1;
    }
}

fn rewrite_toml_id(src: &str, new_id: &str) -> Result<String, SchemaError> {
    let mut meta: ThemeMetadata = toml::from_str(src)?;
    meta.id = new_id.to_string();
    Ok(toml::to_string(&meta).unwrap_or_default())
}

fn io_err(id: &str, source: std::io::Error) -> LoadError {
    LoadError::Io { id: id.to_string(), source }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_theme(dir: &Path, id: &str, scheme: &str, tokens: &str) {
        let theme = dir.join(id);
        std::fs::create_dir_all(&theme).unwrap();
        std::fs::write(
            theme.join("theme.toml"),
            format!("name = \"{id}\"\nid = \"{id}\"\nscheme = \"{scheme}\"\n"),
        )
        .unwrap();
        std::fs::write(theme.join("tokens.css"), tokens).unwrap();
    }

    #[test]
    fn empty_built_ins_returns_only_custom() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        write_theme(custom, "user-theme", "dark", ":root[data-theme=\"user-theme\"]{}");

        let list = list_themes(custom);
        assert!(list.iter().any(|t| t.metadata.id == "user-theme" && !t.built_in));
    }

    #[test]
    fn custom_theme_css_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        write_theme(custom, "u", "light", ":root[data-theme=\"u\"]{--bg-0:#fff}");

        let css = get_theme_css("u", custom).unwrap();
        assert!(css.tokens.contains("--bg-0"));
        assert!(css.personality.is_empty());
    }

    #[test]
    fn missing_theme_returns_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let err = get_theme_css("does-not-exist", tmp.path()).unwrap_err();
        assert!(matches!(err, LoadError::NotFound { .. }));
    }

    #[test]
    fn malformed_theme_toml_is_skipped_in_listing() {
        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("broken");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join("theme.toml"), "this is not toml = =").unwrap();
        std::fs::write(bad.join("tokens.css"), "").unwrap();

        write_theme(tmp.path(), "ok", "dark", "");

        let list = list_themes(tmp.path());
        assert!(list.iter().any(|t| t.metadata.id == "ok"));
        assert!(!list.iter().any(|t| t.metadata.id == "broken"));
    }

    #[test]
    fn unique_id_increments_when_taken() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(unique_id(tmp.path(), "x"), "x-copy");
        std::fs::create_dir_all(tmp.path().join("x-copy")).unwrap();
        assert_eq!(unique_id(tmp.path(), "x"), "x-copy-2");
        std::fs::create_dir_all(tmp.path().join("x-copy-2")).unwrap();
        assert_eq!(unique_id(tmp.path(), "x"), "x-copy-3");
    }

    #[test]
    fn rewrite_toml_id_replaces_id_field() {
        let src = "name = \"X\"\nid = \"old\"\nscheme = \"dark\"\n";
        let out = rewrite_toml_id(src, "new").unwrap();
        let meta: ThemeMetadata = toml::from_str(&out).unwrap();
        assert_eq!(meta.id, "new");
        assert_eq!(meta.name, "X");
    }
}
