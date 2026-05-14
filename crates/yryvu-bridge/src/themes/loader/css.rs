// SPDX-License-Identifier: AGPL-3.0-or-later

//! Theme CSS reader. Returns `tokens.css` (required) + `personality.css`
//! (optional) as a single [`ThemeCss`] payload. Custom shadows built-in.

use std::path::Path;

use super::metadata::custom_exists;
use super::{
    io_err, read_built_in_utf8, LoadError, ThemeCss, BUILT_INS, FILE_PERSONALITY_CSS,
    FILE_TOKENS_CSS,
};

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

fn load_built_in_css(id: &str) -> Result<ThemeCss, LoadError> {
    let tokens = read_built_in_utf8(id, FILE_TOKENS_CSS)?.to_string();
    let personality = BUILT_INS
        .get_file(format!("{id}/{FILE_PERSONALITY_CSS}"))
        .and_then(|f| f.contents_utf8())
        .map(String::from)
        .unwrap_or_default();
    Ok(ThemeCss {
        tokens,
        personality,
    })
}

fn load_custom_css(dir: &Path, id: &str) -> Result<ThemeCss, LoadError> {
    let theme_dir = dir.join(id);
    let tokens =
        std::fs::read_to_string(theme_dir.join(FILE_TOKENS_CSS)).map_err(|e| io_err(id, e))?;
    let personality =
        std::fs::read_to_string(theme_dir.join(FILE_PERSONALITY_CSS)).unwrap_or_default();
    Ok(ThemeCss {
        tokens,
        personality,
    })
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
        assert!(css.personality.is_empty());
    }

    #[test]
    fn missing_theme_returns_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let err = get_theme_css("does-not-exist", tmp.path()).unwrap_err();
        assert!(matches!(err, LoadError::NotFound { .. }));
    }
}
