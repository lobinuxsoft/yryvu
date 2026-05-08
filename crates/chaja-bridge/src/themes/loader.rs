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

/// Copy a built-in theme to `<custom_dir>/<new_id>/`, rewriting `id` +
/// `name` in `theme.toml` and the `:root[data-theme="…"]` selector in
/// `tokens.css`. The new name mirrors the source ("Synthwave" → "Synthwave
/// Copy", second copy "Synthwave Copy 2") so the dropdown shows the
/// origin of every fork. Returns the generated `new_id`.
pub fn create_from_template(
    builtin_id: &str,
    custom_dir: &Path,
) -> Result<String, LoadError> {
    if BUILT_INS.get_dir(builtin_id).is_none() {
        return Err(LoadError::NotFound { id: builtin_id.to_string() });
    }

    let toml_src = read_built_in_utf8(builtin_id, FILE_THEME_TOML)?;
    let source_meta: ThemeMetadata =
        toml::from_str(toml_src).map_err(|e| LoadError::Schema {
            id: builtin_id.to_string(),
            source: SchemaError::Parse(e),
        })?;

    let copy = unique_copy(custom_dir, builtin_id, &source_meta.name);
    let dest = custom_dir.join(&copy.id);
    std::fs::create_dir_all(&dest).map_err(|e| io_err(&copy.id, e))?;

    let toml_rewritten = rewrite_toml_metadata(toml_src, &copy.id, &copy.name)
        .map_err(|e| LoadError::Schema { id: copy.id.clone(), source: e })?;
    std::fs::write(dest.join(FILE_THEME_TOML), toml_rewritten)
        .map_err(|e| io_err(&copy.id, e))?;

    let tokens_src = read_built_in_utf8(builtin_id, FILE_TOKENS_CSS)?;
    let tokens_rewritten = tokens_src.replace(
        &format!(":root[data-theme=\"{builtin_id}\"]"),
        &format!(":root[data-theme=\"{}\"]", &copy.id),
    );
    std::fs::write(dest.join(FILE_TOKENS_CSS), tokens_rewritten)
        .map_err(|e| io_err(&copy.id, e))?;

    if let Some(p) = BUILT_INS
        .get_file(format!("{builtin_id}/{FILE_PERSONALITY_CSS}"))
        .and_then(|f| f.contents_utf8())
    {
        std::fs::write(dest.join(FILE_PERSONALITY_CSS), p)
            .map_err(|e| io_err(&copy.id, e))?;
    }

    Ok(copy.id)
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

struct CopyName {
    id: String,
    name: String,
}

/// Strip the alphabetical sort prefix used by built-ins (`a-default`,
/// `b-tokyo-night`, …) — that prefix is meaningless for user themes
/// (custom shadows built-in by id, never co-sorted) and noisy in the
/// file manager. `d-synthwave` → `synthwave`.
fn strip_sort_prefix(id: &str) -> &str {
    let bytes = id.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b'-' {
        &id[2..]
    } else {
        id
    }
}

/// Generate a unique copy id + matching human name. The id strips the
/// built-in sort prefix and appends `-copy[-N]` for filesystem
/// uniqueness; the name appends `Copy[ N]` so the same counter shows up
/// in both. `d-synthwave` / "Synthwave" → `synthwave-copy` /
/// "Synthwave Copy", second copy `synthwave-copy-2` / "Synthwave Copy 2".
fn unique_copy(custom_dir: &Path, base_id: &str, base_name: &str) -> CopyName {
    let id_root = strip_sort_prefix(base_id);
    let candidate_id = format!("{id_root}-copy");
    if !custom_dir.join(&candidate_id).exists() {
        return CopyName {
            id: candidate_id,
            name: format!("{base_name} Copy"),
        };
    }
    let mut n = 2;
    loop {
        let cid = format!("{id_root}-copy-{n}");
        if !custom_dir.join(&cid).exists() {
            return CopyName {
                id: cid,
                name: format!("{base_name} Copy {n}"),
            };
        }
        n += 1;
    }
}

fn rewrite_toml_metadata(
    src: &str,
    new_id: &str,
    new_name: &str,
) -> Result<String, SchemaError> {
    let mut meta: ThemeMetadata = toml::from_str(src)?;
    meta.id = new_id.to_string();
    meta.name = new_name.to_string();
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
    fn custom_theme_appears_alongside_built_ins() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        write_theme(custom, "user-theme", "dark", ":root[data-theme=\"user-theme\"]{}");

        let list = list_themes(custom);
        assert!(list.iter().any(|t| t.metadata.id == "user-theme" && !t.built_in));
    }

    #[test]
    fn ten_built_ins_are_all_loadable() {
        let tmp = tempfile::tempdir().unwrap();
        let list = list_themes(tmp.path());
        let built_ins: Vec<&ThemeEntry> = list.iter().filter(|t| t.built_in).collect();
        assert_eq!(
            built_ins.len(),
            10,
            "expected 10 built-in themes embedded, got {}: {:?}",
            built_ins.len(),
            built_ins.iter().map(|t| &t.metadata.id).collect::<Vec<_>>()
        );

        let expected_ids = [
            "a-default", "b-tokyo-night", "c-catppuccin-mocha", "d-synthwave",
            "e-rose-pine-dawn", "f-gruvbox-dark", "g-nord", "h-dracula",
            "i-everforest-dark", "j-kanagawa",
        ];
        for id in expected_ids {
            assert!(
                built_ins.iter().any(|t| t.metadata.id == id),
                "missing built-in `{id}`"
            );
            let css = get_theme_css(id, tmp.path()).unwrap();
            assert!(
                css.tokens.contains(&format!("[data-theme=\"{id}\"]")),
                "tokens.css for `{id}` missing scoped selector"
            );
        }
    }

    #[test]
    fn rose_pine_dawn_is_the_only_light_built_in() {
        let tmp = tempfile::tempdir().unwrap();
        let list = list_themes(tmp.path());
        let lights: Vec<&str> = list
            .iter()
            .filter(|t| t.built_in && matches!(t.metadata.scheme, super::super::schema::Scheme::Light))
            .map(|t| t.metadata.id.as_str())
            .collect();
        assert_eq!(lights, vec!["e-rose-pine-dawn"]);
    }

    #[test]
    fn custom_shadows_built_in_when_id_collides() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        write_theme(custom, "a-default", "light", ":root[data-theme=\"a-default\"]{--shadowed:1}");

        let list = list_themes(custom);
        let a_default = list
            .iter()
            .find(|t| t.metadata.id == "a-default")
            .expect("a-default should be present");
        assert!(!a_default.built_in, "custom should shadow built-in");
        assert_eq!(a_default.metadata.scheme, super::super::schema::Scheme::Light);

        let css = get_theme_css("a-default", custom).unwrap();
        assert!(css.tokens.contains("--shadowed"));
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
    fn strip_sort_prefix_drops_leading_letter_dash() {
        assert_eq!(strip_sort_prefix("d-synthwave"), "synthwave");
        assert_eq!(strip_sort_prefix("a-default"), "default");
        assert_eq!(strip_sort_prefix("e-rose-pine-dawn"), "rose-pine-dawn");
        // No prefix to strip
        assert_eq!(strip_sort_prefix("custom-theme"), "custom-theme");
        assert_eq!(strip_sort_prefix("synthwave"), "synthwave");
        // Edge cases
        assert_eq!(strip_sort_prefix("a"), "a");
        assert_eq!(strip_sort_prefix(""), "");
        assert_eq!(strip_sort_prefix("1-not-a-letter"), "1-not-a-letter");
    }

    #[test]
    fn unique_copy_strips_prefix_and_increments_when_taken() {
        let tmp = tempfile::tempdir().unwrap();
        let first = unique_copy(tmp.path(), "d-synthwave", "Synthwave");
        assert_eq!(first.id, "synthwave-copy");
        assert_eq!(first.name, "Synthwave Copy");

        std::fs::create_dir_all(tmp.path().join("synthwave-copy")).unwrap();
        let second = unique_copy(tmp.path(), "d-synthwave", "Synthwave");
        assert_eq!(second.id, "synthwave-copy-2");
        assert_eq!(second.name, "Synthwave Copy 2");

        std::fs::create_dir_all(tmp.path().join("synthwave-copy-2")).unwrap();
        let third = unique_copy(tmp.path(), "d-synthwave", "Synthwave");
        assert_eq!(third.id, "synthwave-copy-3");
        assert_eq!(third.name, "Synthwave Copy 3");
    }

    #[test]
    fn rewrite_toml_metadata_replaces_id_and_name() {
        let src = "name = \"Synthwave\"\nid = \"d-synthwave\"\nscheme = \"dark\"\n";
        let out = rewrite_toml_metadata(src, "synthwave-copy", "Synthwave Copy").unwrap();
        let meta: ThemeMetadata = toml::from_str(&out).unwrap();
        assert_eq!(meta.id, "synthwave-copy");
        assert_eq!(meta.name, "Synthwave Copy");
        assert_eq!(meta.scheme, super::super::schema::Scheme::Dark);
    }

    #[test]
    fn create_from_template_copies_metadata_and_renames() {
        let tmp = tempfile::tempdir().unwrap();
        let new_id = create_from_template("d-synthwave", tmp.path()).unwrap();
        assert_eq!(new_id, "synthwave-copy");

        let copied_dir = tmp.path().join(&new_id);
        assert!(copied_dir.is_dir());

        let toml_src = std::fs::read_to_string(copied_dir.join("theme.toml")).unwrap();
        let meta: ThemeMetadata = toml::from_str(&toml_src).unwrap();
        assert_eq!(meta.id, "synthwave-copy");
        assert_eq!(meta.name, "Synthwave Copy");
        assert_eq!(meta.scheme, super::super::schema::Scheme::Dark);

        let tokens = std::fs::read_to_string(copied_dir.join("tokens.css")).unwrap();
        assert!(
            tokens.contains("[data-theme=\"synthwave-copy\"]"),
            "tokens.css selector not rewritten: {tokens}"
        );
        assert!(
            !tokens.contains("[data-theme=\"d-synthwave\"]"),
            "old selector lingered: {tokens}"
        );
    }
}
