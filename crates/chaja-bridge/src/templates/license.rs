// SPDX-License-Identifier: AGPL-3.0-or-later

//! Curated license templates sourced from the GitHub Licenses API.
//! `{{year}}` and `{{author}}` are placeholders that
//! [`render_license`] substitutes when writing `LICENSE` to the
//! initialized repo. Licenses without placeholders pass through
//! unchanged.

use super::TemplateEntry;

pub const ALL_LICENSE: &[TemplateEntry] = &[
    TemplateEntry {
        name: "mit",
        display_label: "MIT License",
        content: include_str!("../../resources/license/mit.txt"),
    },
    TemplateEntry {
        name: "apache-2.0",
        display_label: "Apache License 2.0",
        content: include_str!("../../resources/license/apache-2.0.txt"),
    },
    TemplateEntry {
        name: "agpl-3.0",
        display_label: "GNU Affero General Public License v3.0",
        content: include_str!("../../resources/license/agpl-3.0.txt"),
    },
    TemplateEntry {
        name: "gpl-3.0",
        display_label: "GNU General Public License v3.0",
        content: include_str!("../../resources/license/gpl-3.0.txt"),
    },
    TemplateEntry {
        name: "bsd-2-clause",
        display_label: "BSD 2-Clause \"Simplified\" License",
        content: include_str!("../../resources/license/bsd-2-clause.txt"),
    },
    TemplateEntry {
        name: "bsd-3-clause",
        display_label: "BSD 3-Clause \"New\" or \"Revised\" License",
        content: include_str!("../../resources/license/bsd-3-clause.txt"),
    },
    TemplateEntry {
        name: "mpl-2.0",
        display_label: "Mozilla Public License 2.0",
        content: include_str!("../../resources/license/mpl-2.0.txt"),
    },
    TemplateEntry {
        name: "isc",
        display_label: "ISC License",
        content: include_str!("../../resources/license/isc.txt"),
    },
    TemplateEntry {
        name: "unlicense",
        display_label: "The Unlicense",
        content: include_str!("../../resources/license/unlicense.txt"),
    },
    TemplateEntry {
        name: "cc0-1.0",
        display_label: "Creative Commons Zero v1.0 Universal",
        content: include_str!("../../resources/license/cc0-1.0.txt"),
    },
];

pub fn render_license(template: &str, year: i32, author: &str) -> String {
    template
        .replace("{{year}}", &year.to_string())
        .replace("{{author}}", author)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutes_year_and_author() {
        let mit = TemplateEntry::lookup(ALL_LICENSE, "mit").unwrap();
        let rendered = render_license(mit.content, 2026, "Capybara");
        assert!(rendered.contains("2026"));
        assert!(rendered.contains("Capybara"));
        assert!(!rendered.contains("{{year}}"));
        assert!(!rendered.contains("{{author}}"));
    }

    #[test]
    fn passes_through_when_no_placeholders() {
        let gpl = TemplateEntry::lookup(ALL_LICENSE, "gpl-3.0").unwrap();
        let rendered = render_license(gpl.content, 2026, "Anyone");
        assert_eq!(rendered, gpl.content);
    }

    #[test]
    fn all_have_unique_names() {
        let mut names: Vec<&str> = ALL_LICENSE.iter().map(|t| t.name).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), ALL_LICENSE.len());
    }
}
