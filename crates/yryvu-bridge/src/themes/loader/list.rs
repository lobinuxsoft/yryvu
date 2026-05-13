// SPDX-License-Identifier: AGPL-3.0-or-later

//! Theme listing: scan built-ins + custom dir, fold into a deduped
//! sorted [`Vec<ThemeEntry>`].

use std::collections::BTreeMap;
use std::path::Path;

use super::metadata::{built_in_metadata, custom_metadata};
use super::{ThemeEntry, BUILT_INS};

/// List every theme available. Custom themes shadow built-ins by id —
/// when both exist, only the custom version appears. Returned list is
/// sorted by id (BTreeMap iteration).
pub fn list_themes(custom_dir: &Path) -> Vec<ThemeEntry> {
    let mut by_id: BTreeMap<String, ThemeEntry> = BTreeMap::new();

    for folder in built_in_folders() {
        if let Ok(meta) = built_in_metadata(&folder) {
            by_id.insert(
                folder.clone(),
                ThemeEntry {
                    metadata: meta,
                    built_in: true,
                },
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
                        ThemeEntry {
                            metadata: meta,
                            built_in: false,
                        },
                    );
                }
            }
        }
    }

    by_id.into_values().collect()
}

fn built_in_folders() -> Vec<String> {
    BUILT_INS
        .dirs()
        .filter_map(|d| {
            d.path()
                .file_name()
                .and_then(|s| s.to_str())
                .map(String::from)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::{get_theme_css, write_theme_fixture, ThemeEntry};
    use super::*;
    use crate::themes::schema;

    #[test]
    fn custom_theme_appears_alongside_built_ins() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path();
        write_theme_fixture(
            custom,
            "user-theme",
            "dark",
            ":root[data-theme=\"user-theme\"]{}",
        );

        let list = list_themes(custom);
        assert!(list
            .iter()
            .any(|t| t.metadata.id == "user-theme" && !t.built_in));
    }

    #[test]
    fn ten_built_ins_are_all_loadable() {
        let tmp = tempfile::tempdir().unwrap();
        let list = list_themes(tmp.path());
        let built_ins: Vec<&ThemeEntry> = list.iter().filter(|t| t.built_in).collect();
        assert_eq!(
            built_ins.len(),
            11,
            "expected 11 built-in themes embedded, got {}: {:?}",
            built_ins.len(),
            built_ins.iter().map(|t| &t.metadata.id).collect::<Vec<_>>()
        );

        let expected_ids = [
            "a-yryvu",
            "b-tokyo-night",
            "c-catppuccin-mocha",
            "d-synthwave",
            "e-rose-pine-dawn",
            "f-gruvbox-dark",
            "g-nord",
            "h-dracula",
            "i-everforest-dark",
            "j-kanagawa",
            "k-default",
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
            .filter(|t| t.built_in && matches!(t.metadata.scheme, schema::Scheme::Light))
            .map(|t| t.metadata.id.as_str())
            .collect();
        assert_eq!(lights, vec!["e-rose-pine-dawn"]);
    }

    #[test]
    fn malformed_theme_toml_is_skipped_in_listing() {
        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("broken");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join("theme.toml"), "this is not toml = =").unwrap();
        std::fs::write(bad.join("tokens.css"), "").unwrap();

        write_theme_fixture(tmp.path(), "ok", "dark", "");

        let list = list_themes(tmp.path());
        assert!(list.iter().any(|t| t.metadata.id == "ok"));
        assert!(!list.iter().any(|t| t.metadata.id == "broken"));
    }
}
