// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands listing the bundled gitignore + license templates.
//! Data is `include_str!`-bundled and static, so the commands are sync
//! and allocation-only.

use crate::templates::{collect_info, TemplateInfo, ALL_GITIGNORE, ALL_LICENSE};

#[tauri::command]
pub fn list_gitignore_templates() -> Vec<TemplateInfo> {
    collect_info(ALL_GITIGNORE)
}

#[tauri::command]
pub fn list_license_templates() -> Vec<TemplateInfo> {
    collect_info(ALL_LICENSE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gitignore_count_matches_bundle() {
        assert_eq!(list_gitignore_templates().len(), ALL_GITIGNORE.len());
    }

    #[test]
    fn license_count_matches_bundle() {
        assert_eq!(list_license_templates().len(), ALL_LICENSE.len());
    }

    #[test]
    fn info_carries_display_label() {
        let infos = list_gitignore_templates();
        let rust = infos.iter().find(|i| i.name == "rust").unwrap();
        assert_eq!(rust.display_label, "Rust");
    }
}
