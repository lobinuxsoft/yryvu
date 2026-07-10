// SPDX-License-Identifier: AGPL-3.0-or-later

//! Theme CSS reader. Returns the `tokens` / `icons` / `personality`
//! layers as a single [`ThemeCss`] payload, ready for the frontend to
//! inject as three independent `<style>` elements.
//!
//! Two layouts are supported:
//! - **Legacy (flat)** — no `[layers]` table: `tokens.css` (required) +
//!   `personality.css` (optional). No icons layer.
//! - **Layered** — a `[layers]` table maps each layer to a single file,
//!   an explicit ordered list, or a directory (`"personality/"`) whose
//!   `*.css` files are concatenated in alphabetical filename order.
//!
//! Both built-in (`include_dir!`) and custom (filesystem) themes flow
//! through the same [`Source`] abstraction so the resolution logic lives
//! in one place.

use std::path::{Path, PathBuf};

use crate::themes::schema::{self, Layers, PathSpec};

use super::metadata::custom_exists;
use super::{
    read_built_in_utf8, LoadError, ThemeCss, BUILT_INS, FILE_PERSONALITY_CSS, FILE_THEME_TOML,
    FILE_TOKENS_CSS,
};

/// Fetch CSS for a theme by id. Custom shadows built-in.
pub fn get_theme_css(id: &str, custom_dir: &Path) -> Result<ThemeCss, LoadError> {
    if custom_exists(custom_dir, id) {
        Source::Custom {
            theme_dir: custom_dir.join(id),
        }
        .load(id)
    } else if BUILT_INS.get_dir(id).is_some() {
        Source::BuiltIn.load(id)
    } else {
        Err(LoadError::NotFound { id: id.to_string() })
    }
}

/// A theme's file backing — embedded at compile time or on disk. Both
/// expose the same read/list surface so layer resolution stays uniform.
enum Source {
    BuiltIn,
    Custom { theme_dir: PathBuf },
}

impl Source {
    /// Resolve every layer into the final [`ThemeCss`] payload.
    fn load(&self, id: &str) -> Result<ThemeCss, LoadError> {
        let toml_src = self.read_file(id, FILE_THEME_TOML)?;
        let layers = schema::parse_layers(&toml_src).map_err(|e| LoadError::Schema {
            id: id.to_string(),
            source: e,
        })?;

        match layers {
            Some(layers) => self.load_layered(id, &layers),
            None => self.load_flat(id),
        }
    }

    /// Legacy layout: required `tokens.css`, optional `personality.css`,
    /// no icons. A missing `personality.css` is not an error.
    fn load_flat(&self, id: &str) -> Result<ThemeCss, LoadError> {
        let tokens = self.read_file(id, FILE_TOKENS_CSS)?;
        let personality = self.read_optional(id, FILE_PERSONALITY_CSS)?;
        Ok(ThemeCss {
            tokens,
            icons: String::new(),
            personality,
        })
    }

    /// `[layers]` layout: `tokens` is required (defaults to `tokens.css`);
    /// `icons` and `personality` load only when declared. Every declared
    /// file must exist — a missing one surfaces as [`LoadError::MissingFile`].
    fn load_layered(&self, id: &str, layers: &Layers) -> Result<ThemeCss, LoadError> {
        let tokens = self.resolve(id, &layers.tokens)?;
        let icons = self.resolve_optional(id, layers.icons.as_ref())?;
        let personality = self.resolve_optional(id, layers.personality.as_ref())?;
        Ok(ThemeCss {
            tokens,
            icons,
            personality,
        })
    }

    fn resolve_optional(&self, id: &str, spec: Option<&PathSpec>) -> Result<String, LoadError> {
        match spec {
            Some(spec) => self.resolve(id, spec),
            None => Ok(String::new()),
        }
    }

    /// Resolve one [`PathSpec`] to concatenated CSS.
    fn resolve(&self, id: &str, spec: &PathSpec) -> Result<String, LoadError> {
        match spec {
            PathSpec::Single(name) => match name.strip_suffix('/') {
                Some(dir) => self.concat(id, &self.list_css(id, dir)?),
                None => self.read_file(id, name),
            },
            PathSpec::List(names) => self.concat(id, names),
        }
    }

    /// Read + join each file with a blank line between so adjacent rules
    /// never accidentally merge across a missing trailing newline.
    fn concat(&self, id: &str, names: &[String]) -> Result<String, LoadError> {
        let mut out = String::new();
        for name in names {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&self.read_file(id, name)?);
        }
        Ok(out)
    }

    /// Alphabetically-sorted `*.css` filenames (relative to the theme
    /// dir, e.g. `personality/01-toolbar.css`) inside `dir`. A missing
    /// directory is an error; an empty one yields no files.
    fn list_css(&self, id: &str, dir: &str) -> Result<Vec<String>, LoadError> {
        let mut names = match self {
            Source::BuiltIn => {
                let sub = BUILT_INS.get_dir(format!("{id}/{dir}")).ok_or_else(|| {
                    LoadError::MissingFile {
                        id: id.to_string(),
                        file: format!("{dir}/"),
                    }
                })?;
                sub.files()
                    .filter_map(|f| {
                        f.path()
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                    })
                    .filter(|n| n.ends_with(".css"))
                    .map(|n| format!("{dir}/{n}"))
                    .collect::<Vec<_>>()
            }
            Source::Custom { theme_dir } => {
                let sub = theme_dir.join(dir);
                let entries = std::fs::read_dir(&sub).map_err(|_| LoadError::MissingFile {
                    id: id.to_string(),
                    file: format!("{dir}/"),
                })?;
                entries
                    .filter_map(Result::ok)
                    .filter_map(|e| e.file_name().to_str().map(String::from))
                    .filter(|n| n.ends_with(".css"))
                    .map(|n| format!("{dir}/{n}"))
                    .collect::<Vec<_>>()
            }
        };
        names.sort();
        Ok(names)
    }

    /// Read a file relative to the theme root. Missing → `MissingFile`.
    fn read_file(&self, id: &str, rel: &str) -> Result<String, LoadError> {
        match self {
            Source::BuiltIn => read_built_in_utf8(id, rel).map(String::from),
            Source::Custom { theme_dir } => {
                std::fs::read_to_string(theme_dir.join(rel)).map_err(|e| map_fs_err(id, rel, e))
            }
        }
    }

    /// Like [`read_file`] but a missing file yields an empty string
    /// instead of an error. Used for the optional flat `personality.css`.
    fn read_optional(&self, id: &str, rel: &str) -> Result<String, LoadError> {
        match self.read_file(id, rel) {
            Ok(s) => Ok(s),
            Err(LoadError::MissingFile { .. }) => Ok(String::new()),
            Err(e) => Err(e),
        }
    }
}

fn map_fs_err(id: &str, rel: &str, e: std::io::Error) -> LoadError {
    if e.kind() == std::io::ErrorKind::NotFound {
        LoadError::MissingFile {
            id: id.to_string(),
            file: rel.to_string(),
        }
    } else {
        LoadError::Io {
            id: id.to_string(),
            source: e,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{list_themes, write_theme_fixture};
    use super::*;
    use crate::themes::schema;

    #[test]
    fn custom_shadows_built_in_when_id_collides() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        write_theme_fixture(
            custom,
            "a-yryvu",
            "light",
            ":root[data-theme=\"a-yryvu\"]{--shadowed:1}",
        );

        let list = list_themes(custom);
        let a_yryvu = list
            .iter()
            .find(|t| t.metadata.id == "a-yryvu")
            .expect("a-yryvu should be present");
        assert!(!a_yryvu.built_in, "custom should shadow built-in");
        assert_eq!(a_yryvu.metadata.scheme, schema::Scheme::Light);

        let css = get_theme_css("a-yryvu", custom).unwrap();
        assert!(css.tokens.contains("--shadowed"));
    }

    #[test]
    fn custom_theme_css_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        write_theme_fixture(custom, "u", "light", ":root[data-theme=\"u\"]{--bg-0:#fff}");

        let css = get_theme_css("u", custom).unwrap();
        assert!(css.tokens.contains("--bg-0"));
        assert!(css.icons.is_empty());
        assert!(css.personality.is_empty());
    }

    #[test]
    fn missing_theme_returns_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let err = get_theme_css("does-not-exist", tmp.path()).unwrap_err();
        assert!(matches!(err, LoadError::NotFound { .. }));
    }

    /// Write a theme folder with an explicit `theme.toml` body so tests
    /// can exercise `[layers]`. `write_theme_fixture` only emits the flat
    /// metadata, so layered fixtures build the folder by hand.
    fn write_layered(dir: &Path, id: &str, toml_body: &str) -> PathBuf {
        let theme = dir.join(id);
        std::fs::create_dir_all(&theme).unwrap();
        std::fs::write(theme.join(FILE_THEME_TOML), toml_body).unwrap();
        std::fs::write(theme.join(FILE_TOKENS_CSS), format!("/* {id} tokens */")).unwrap();
        theme
    }

    #[test]
    fn layered_directory_concatenates_alphabetically() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        let theme = write_layered(
            custom,
            "lay",
            "name = \"L\"\nid = \"lay\"\nscheme = \"dark\"\n\n[layers]\npersonality = \"personality/\"\n",
        );
        let pdir = theme.join("personality");
        std::fs::create_dir_all(&pdir).unwrap();
        // Written out of order; the loader must sort by filename.
        std::fs::write(pdir.join("02-b.css"), ".b{}").unwrap();
        std::fs::write(pdir.join("01-a.css"), ".a{}").unwrap();
        std::fs::write(pdir.join("notes.txt"), "ignored").unwrap();

        let css = get_theme_css("lay", custom).unwrap();
        let a = css.personality.find(".a{}").expect("a present");
        let b = css.personality.find(".b{}").expect("b present");
        assert!(a < b, "alphabetical: 01-a before 02-b");
        assert!(
            !css.personality.contains("ignored"),
            "non-css files skipped"
        );
    }

    #[test]
    fn layered_missing_declared_file_errors_clearly() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        write_layered(
            custom,
            "bad",
            "name = \"B\"\nid = \"bad\"\nscheme = \"dark\"\n\n[layers]\nicons = \"icons.css\"\n",
        );
        // icons.css was never written.
        let err = get_theme_css("bad", custom).unwrap_err();
        match err {
            LoadError::MissingFile { id, file } => {
                assert_eq!(id, "bad");
                assert_eq!(file, "icons.css");
            }
            other => panic!("expected MissingFile, got {other:?}"),
        }
    }

    #[test]
    fn layered_list_preserves_order() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        let theme = write_layered(
            custom,
            "ord",
            "name = \"O\"\nid = \"ord\"\nscheme = \"dark\"\n\n[layers]\npersonality = [\"z.css\", \"a.css\"]\n",
        );
        std::fs::write(theme.join("z.css"), ".z{}").unwrap();
        std::fs::write(theme.join("a.css"), ".a{}").unwrap();

        let css = get_theme_css("ord", custom).unwrap();
        let z = css.personality.find(".z{}").unwrap();
        let a = css.personality.find(".a{}").unwrap();
        assert!(z < a, "explicit list order is honoured, not sorted");
    }
}
