// SPDX-License-Identifier: AGPL-3.0-or-later

//! Theme duplication: clone a built-in to `<custom_dir>/<new_id>/`,
//! rewriting `id` + `name` so the result is a self-contained custom
//! theme the user can edit without affecting the embedded built-in.

use std::path::Path;

use crate::themes::schema::{SchemaError, ThemeMetadata};

use super::{
    io_err, read_built_in_utf8, LoadError, BUILT_INS, FILE_PERSONALITY_CSS, FILE_THEME_TOML,
    FILE_TOKENS_CSS,
};

/// Copy a built-in theme to `<custom_dir>/<new_id>/`, rewriting `id` +
/// `name` in `theme.toml` and the `:root[data-theme="…"]` selector in
/// `tokens.css`. The new name mirrors the source ("Synthwave" → "Synthwave
/// Copy", second copy "Synthwave Copy 2") so the dropdown shows the
/// origin of every fork. Returns the generated `new_id`.
pub fn create_from_template(builtin_id: &str, custom_dir: &Path) -> Result<String, LoadError> {
    if BUILT_INS.get_dir(builtin_id).is_none() {
        return Err(LoadError::NotFound {
            id: builtin_id.to_string(),
        });
    }

    let toml_src = read_built_in_utf8(builtin_id, FILE_THEME_TOML)?;
    let source_meta: ThemeMetadata = toml::from_str(toml_src).map_err(|e| LoadError::Schema {
        id: builtin_id.to_string(),
        source: SchemaError::Parse(e),
    })?;

    let copy = unique_copy(custom_dir, builtin_id, &source_meta.name);
    let dest = custom_dir.join(&copy.id);
    std::fs::create_dir_all(&dest).map_err(|e| io_err(&copy.id, e))?;

    let toml_rewritten =
        rewrite_toml_metadata(toml_src, &copy.id, &copy.name).map_err(|e| LoadError::Schema {
            id: copy.id.clone(),
            source: e,
        })?;
    std::fs::write(dest.join(FILE_THEME_TOML), toml_rewritten).map_err(|e| io_err(&copy.id, e))?;

    let tokens_src = read_built_in_utf8(builtin_id, FILE_TOKENS_CSS)?;
    let tokens_rewritten = tokens_src.replace(
        &format!(":root[data-theme=\"{builtin_id}\"]"),
        &format!(":root[data-theme=\"{}\"]", copy.id),
    );
    std::fs::write(dest.join(FILE_TOKENS_CSS), tokens_rewritten)
        .map_err(|e| io_err(&copy.id, e))?;

    if let Some(p) = BUILT_INS
        .get_file(format!("{builtin_id}/{FILE_PERSONALITY_CSS}"))
        .and_then(|f| f.contents_utf8())
    {
        std::fs::write(dest.join(FILE_PERSONALITY_CSS), p).map_err(|e| io_err(&copy.id, e))?;
    }

    Ok(copy.id)
}

struct CopyName {
    id: String,
    name: String,
}

/// Strip the alphabetical sort prefix used by built-ins (`a-yryvu`,
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

fn rewrite_toml_metadata(src: &str, new_id: &str, new_name: &str) -> Result<String, SchemaError> {
    let mut meta: ThemeMetadata = toml::from_str(src)?;
    meta.id = new_id.to_string();
    meta.name = new_name.to_string();
    Ok(toml::to_string(&meta).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::themes::schema;

    #[test]
    fn strip_sort_prefix_drops_leading_letter_dash() {
        assert_eq!(strip_sort_prefix("d-synthwave"), "synthwave");
        assert_eq!(strip_sort_prefix("a-yryvu"), "yryvu");
        assert_eq!(strip_sort_prefix("k-default"), "default");
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
        assert_eq!(meta.scheme, schema::Scheme::Dark);
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
        assert_eq!(meta.scheme, schema::Scheme::Dark);

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
