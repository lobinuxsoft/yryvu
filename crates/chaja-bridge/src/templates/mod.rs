// SPDX-License-Identifier: AGPL-3.0-or-later

//! Bundled gitignore + license templates. All template contents are
//! `include_str!`-bundled at compile time; no runtime FS dependency.

mod gitignore;
mod license;

pub use gitignore::ALL_GITIGNORE;
pub use license::{render_license, ALL_LICENSE};

pub struct TemplateEntry {
    pub name: &'static str,
    pub display_label: &'static str,
    pub content: &'static str,
}

impl TemplateEntry {
    pub fn lookup<'a>(set: &'a [TemplateEntry], name: &str) -> Option<&'a TemplateEntry> {
        set.iter().find(|t| t.name == name)
    }

    pub fn to_info(&self) -> TemplateInfo {
        TemplateInfo {
            name: self.name.to_string(),
            display_label: self.display_label.to_string(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub name: String,
    pub display_label: String,
}

pub fn collect_info(set: &[TemplateEntry]) -> Vec<TemplateInfo> {
    set.iter().map(TemplateEntry::to_info).collect()
}
