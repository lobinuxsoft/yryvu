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
}
