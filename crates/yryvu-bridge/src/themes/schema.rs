// SPDX-License-Identifier: AGPL-3.0-or-later

//! `theme.toml` schema for chajá theme folders.
//!
//! Every theme — built-in or user — ships a `theme.toml` declaring its
//! identity and color scheme. The id MUST match the folder name; the
//! loader rejects mismatches to keep filesystem layout self-describing.
//!
//! `scheme` is locked to `"dark" | "light"`. It drives Monaco editor
//! base (`vs-dark` vs `vs`) and PR diff hunk styling once those land.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SchemaError {
    #[error("theme.toml parse failed")]
    Parse(#[from] toml::de::Error),
    #[error("theme.toml id `{got}` does not match folder name `{expected}`")]
    IdMismatch { got: String, expected: String },
}

/// Color scheme. Drives editor + diff base styling.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Scheme {
    Dark,
    Light,
}

/// Parsed `theme.toml`. `id` must match the folder name (validated post-parse).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ThemeMetadata {
    pub name: String,
    pub id: String,
    pub scheme: Scheme,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Where a theme layer's CSS comes from, inside the theme folder:
/// - a single filename (`"tokens.css"`),
/// - a directory to scan when the string ends in `/` (`"personality/"` —
///   every `*.css` inside, concatenated in alphabetical filename order),
/// - or an explicit ordered list (`["01.css", "02.css"]`).
///
/// `#[serde(untagged)]` lets a TOML string OR array both deserialize here.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(untagged)]
pub enum PathSpec {
    Single(String),
    List(Vec<String>),
}

/// Optional `[layers]` table in `theme.toml`. Opt-in: when the table is
/// absent the loader falls back to the flat `tokens.css` + `personality.css`
/// layout. When present, `tokens` still defaults to `tokens.css`, while
/// `icons` and `personality` are only loaded if explicitly declared.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Layers {
    #[serde(default = "default_tokens_spec")]
    pub tokens: PathSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icons: Option<PathSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personality: Option<PathSpec>,
}

fn default_tokens_spec() -> PathSpec {
    PathSpec::Single("tokens.css".to_string())
}

/// Parse a `theme.toml` source and validate that `id` matches the
/// containing folder name.
pub fn parse(src: &str, expected_folder: &str) -> Result<ThemeMetadata, SchemaError> {
    let meta: ThemeMetadata = toml::from_str(src)?;
    if meta.id != expected_folder {
        return Err(SchemaError::IdMismatch {
            got: meta.id,
            expected: expected_folder.to_string(),
        });
    }
    Ok(meta)
}

/// Parse the optional `[layers]` table from a `theme.toml` source.
/// Returns `None` when the table is absent (legacy flat layout). The
/// metadata fields are ignored here — [`parse`] owns their validation.
pub fn parse_layers(src: &str) -> Result<Option<Layers>, SchemaError> {
    #[derive(Deserialize)]
    struct ManifestDoc {
        #[serde(default)]
        layers: Option<Layers>,
    }
    let doc: ManifestDoc = toml::from_str(src)?;
    Ok(doc.layers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_theme_toml() {
        let src = r#"
            name = "Default Dark"
            id = "k-default"
            scheme = "dark"
        "#;
        let meta = parse(src, "k-default").unwrap();
        assert_eq!(meta.name, "Default Dark");
        assert_eq!(meta.id, "k-default");
        assert_eq!(meta.scheme, Scheme::Dark);
        assert!(meta.author.is_none());
        assert!(meta.version.is_none());
    }

    #[test]
    fn parses_full_theme_toml() {
        let src = r#"
            name = "Tokyo Night"
            id = "b-tokyo-night"
            scheme = "dark"
            author = "Lucila"
            version = "1.0.0"
        "#;
        let meta = parse(src, "b-tokyo-night").unwrap();
        assert_eq!(meta.author.as_deref(), Some("Lucila"));
        assert_eq!(meta.version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn parses_light_scheme() {
        let src = r#"
            name = "Rosé Pine Dawn"
            id = "e-rose-pine-dawn"
            scheme = "light"
        "#;
        let meta = parse(src, "e-rose-pine-dawn").unwrap();
        assert_eq!(meta.scheme, Scheme::Light);
    }

    #[test]
    fn rejects_id_folder_mismatch() {
        let src = r#"
            name = "Default Dark"
            id = "wrong-id"
            scheme = "dark"
        "#;
        let err = parse(src, "k-default").unwrap_err();
        match err {
            SchemaError::IdMismatch { got, expected } => {
                assert_eq!(got, "wrong-id");
                assert_eq!(expected, "k-default");
            }
            other => panic!("wrong error variant: {other:?}"),
        }
    }

    #[test]
    fn rejects_invalid_scheme() {
        let src = r#"
            name = "X"
            id = "x"
            scheme = "purple"
        "#;
        assert!(parse(src, "x").is_err());
    }

    #[test]
    fn rejects_missing_required_field() {
        let src = r#"
            name = "X"
            scheme = "dark"
        "#;
        assert!(parse(src, "x").is_err());
    }

    #[test]
    fn parse_layers_absent_is_none() {
        let src = r#"
            name = "X"
            id = "x"
            scheme = "dark"
        "#;
        assert_eq!(parse_layers(src).unwrap(), None);
    }

    #[test]
    fn parse_layers_dir_and_single_and_list() {
        let src = r#"
            name = "X"
            id = "x"
            scheme = "dark"

            [layers]
            icons = "icons.css"
            personality = "personality/"
        "#;
        let layers = parse_layers(src).unwrap().expect("layers present");
        // tokens defaults even when the field is omitted from [layers].
        assert_eq!(layers.tokens, PathSpec::Single("tokens.css".to_string()));
        assert_eq!(
            layers.icons,
            Some(PathSpec::Single("icons.css".to_string()))
        );
        assert_eq!(
            layers.personality,
            Some(PathSpec::Single("personality/".to_string()))
        );

        let with_list = r#"
            name = "X"
            id = "x"
            scheme = "dark"

            [layers]
            personality = ["01-a.css", "02-b.css"]
        "#;
        let layers = parse_layers(with_list).unwrap().unwrap();
        assert_eq!(
            layers.personality,
            Some(PathSpec::List(vec![
                "01-a.css".to_string(),
                "02-b.css".to_string()
            ]))
        );
    }
}
