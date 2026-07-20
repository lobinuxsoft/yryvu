// SPDX-License-Identifier: AGPL-3.0-or-later

//! Theme duplication: clone a built-in to `<custom_dir>/<new_id>/`,
//! rewriting `id` + `name` so the result is a self-contained custom
//! theme the user can edit without affecting the embedded built-in.

use std::path::Path;

use include_dir::{Dir, File};

use crate::themes::schema::{SchemaError, ThemeMetadata};

use super::{io_err, read_built_in_utf8, LoadError, BUILT_INS, FILE_THEME_TOML, FILE_TOKENS_CSS};

/// Copy a built-in theme to `<custom_dir>/<new_id>/`, rewriting `id` +
/// `name` in `theme.toml` and the `:root[data-theme="…"]` selector in
/// `tokens.css`. The new name mirrors the source ("Synthwave" → "Synthwave
/// Copy", second copy "Synthwave Copy 2") so the dropdown shows the
/// origin of every fork. Returns the generated `new_id`.
///
/// The copy is layout-agnostic: every file in the source folder is cloned
/// recursively (so a layered theme's `personality/` directory + its
/// `[layers]` manifest survive intact), then `theme.toml` and `tokens.css`
/// are patched in place.
pub fn create_from_template(builtin_id: &str, custom_dir: &Path) -> Result<String, LoadError> {
    let src_dir = BUILT_INS
        .get_dir(builtin_id)
        .ok_or_else(|| LoadError::NotFound {
            id: builtin_id.to_string(),
        })?;

    let toml_src = read_built_in_utf8(builtin_id, FILE_THEME_TOML)?;
    let source_meta: ThemeMetadata = toml::from_str(toml_src).map_err(|e| LoadError::Schema {
        id: builtin_id.to_string(),
        source: SchemaError::Parse(e),
    })?;

    let copy = unique_copy(custom_dir, builtin_id, &source_meta.name);
    let dest = custom_dir.join(&copy.id);
    std::fs::create_dir_all(&dest).map_err(|e| io_err(&copy.id, e))?;

    // 1. Clone every file verbatim, preserving the folder layout.
    let mut files = Vec::new();
    collect_files(src_dir, &mut files);
    for file in files {
        let rel = file
            .path()
            .strip_prefix(builtin_id)
            .unwrap_or_else(|_| file.path());
        let out_path = dest.join(rel);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| io_err(&copy.id, e))?;
        }
        std::fs::write(&out_path, file.contents()).map_err(|e| io_err(&copy.id, e))?;
    }

    // 2. Patch theme.toml (id + name, [layers] and everything else kept).
    let toml_rewritten =
        rewrite_toml_metadata(toml_src, &copy.id, &copy.name).map_err(|e| LoadError::Schema {
            id: copy.id.clone(),
            source: e,
        })?;
    std::fs::write(dest.join(FILE_THEME_TOML), toml_rewritten).map_err(|e| io_err(&copy.id, e))?;

    // 3. Re-scope the tokens selector to the new id.
    let tokens_src = read_built_in_utf8(builtin_id, FILE_TOKENS_CSS)?;
    let tokens_rewritten = tokens_src.replace(
        &format!(":root[data-theme=\"{builtin_id}\"]"),
        &format!(":root[data-theme=\"{}\"]", copy.id),
    );
    std::fs::write(dest.join(FILE_TOKENS_CSS), tokens_rewritten)
        .map_err(|e| io_err(&copy.id, e))?;

    Ok(copy.id)
}

/// Depth-first collect of every embedded file under `dir`, so a theme's
/// nested layer directories (e.g. `personality/`) are copied too.
fn collect_files<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a File<'a>>) {
    out.extend(dir.files());
    for sub in dir.dirs() {
        collect_files(sub, out);
    }
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

/// Rewrite only `id` + `name`, preserving every other table (`[layers]`
/// especially) verbatim. A `ThemeMetadata` round-trip would silently drop
/// unknown tables, so mutate the parsed document instead.
fn rewrite_toml_metadata(src: &str, new_id: &str, new_name: &str) -> Result<String, SchemaError> {
    let mut doc: toml::Table = toml::from_str(src)?;
    doc.insert("id".to_string(), toml::Value::String(new_id.to_string()));
    doc.insert(
        "name".to_string(),
        toml::Value::String(new_name.to_string()),
    );
    Ok(toml::to_string(&doc).unwrap_or_default())
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

    #[test]
    fn create_from_template_preserves_layered_structure() {
        // d-synthwave is layered ([layers] + personality/ directory).
        // The copy must carry the manifest and the split files, and load
        // back through the same layered path with its personality intact.
        let tmp = tempfile::tempdir().unwrap();
        let new_id = create_from_template("d-synthwave", tmp.path()).unwrap();
        let copied_dir = tmp.path().join(&new_id);

        let toml_src = std::fs::read_to_string(copied_dir.join("theme.toml")).unwrap();
        assert!(
            toml_src.contains("[layers]"),
            "[layers] table dropped in copy: {toml_src}"
        );
        assert!(
            copied_dir.join("personality").is_dir(),
            "personality/ directory not cloned"
        );

        let css = super::super::get_theme_css(&new_id, tmp.path()).unwrap();
        assert!(
            css.personality.contains("synthwave-toolbar-pulse"),
            "layered personality not resolved for the copy"
        );
    }
}
