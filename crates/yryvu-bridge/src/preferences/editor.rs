// SPDX-License-Identifier: AGPL-3.0-or-later

//! Editor preferences (issue #190) — port of GitKraken's
//! `EditorPreferences` tab. Eight fields KEEP, validated against
//! `app/src/strings/en-us.json` (12 strings with prefix
//! `EditorPreferences-`):
//!
//! - `Font` → font family.
//! - `ShowOnlyMonospace` → font picker filter.
//! - `FontSize` → numeric, pixels.
//! - `EOLCharacter` (+ `EOLCharacterLF` / `EOLCharacterCRLF`) → enum
//!   with two values; no "preserve" mode in the bundle.
//! - `WordWrap` → boolean toggle; no multi-mode enum in the bundle.
//! - `TabSize` → numeric, spaces per tab.
//! - `ShowLineNumbers` → boolean toggle.
//! - `SyntaxHighlighting` → boolean toggle.
//!
//! `NoFontsFound` is an error-state string handled by the View, not a
//! persisted setting.
//!
//! Settings claimed by the original issue body but not in the GK bundle
//! — whitespace display, word-wrap multi-mode, EOL "preserve" — are
//! dropped on purpose: GK does not ship them, so 1:1 parity does not
//! cover them. File separate issues if yryvu wants any of those as a
//! deviation.
//!
//! Backend-only; the panel View lands in a follow-up sub-PR.

use serde::{Deserialize, Serialize};

/// `Preferences > Editor` panel state (issue #190). Mirrors the eight
/// GK settings whose `EditorPreferences-*` strings have a matching
/// control in the panel render. Apply-time wiring (DiffView / FileDiffTab
/// consuming font, line numbers, syntax highlighting, EOL on write)
/// lives in follow-up issues — this struct is persistence only.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorPreferences {
    #[serde(default = "default_font")]
    pub font: String,
    #[serde(default = "default_true")]
    pub show_only_monospace: bool,
    #[serde(default = "default_font_size")]
    pub font_size: u16,
    #[serde(default)]
    pub eol_character: EolCharacter,
    #[serde(default)]
    pub word_wrap: bool,
    #[serde(default = "default_tab_size")]
    pub tab_size: u8,
    #[serde(default = "default_true")]
    pub show_line_numbers: bool,
    #[serde(default = "default_true")]
    pub syntax_highlighting: bool,
}

impl Default for EditorPreferences {
    fn default() -> Self {
        Self {
            font: default_font(),
            show_only_monospace: true,
            font_size: default_font_size(),
            eol_character: EolCharacter::default(),
            word_wrap: false,
            tab_size: default_tab_size(),
            show_line_numbers: true,
            syntax_highlighting: true,
        }
    }
}

/// End-of-line character written by the editor on save. GK ships only
/// these two; preservation of the original file's EOL is handled by
/// Git's own `core.autocrlf` at the repo level, not by this panel.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum EolCharacter {
    /// `\n` — modern default, Git's recommended setting since 2010s.
    #[default]
    Lf,
    /// `\r\n` — Windows native, kept for users who edit files that must
    /// remain CRLF (e.g. `.bat` scripts, some legacy Windows toolchains).
    Crlf,
}

/// CSS generic family that is always resolvable on every platform. The
/// View will offer a real font picker once #190's wave-2 panel lands,
/// but the persisted default needs to render correctly before that.
fn default_font() -> String {
    "monospace".to_string()
}

/// 13 px is the GK default-ish font size for the diff viewer and the
/// most common "code reading" size on a 1080p display. The View will
/// gate to a sensible range without forcing a schema bump if the upper
/// bound moves.
fn default_font_size() -> u16 {
    13
}

/// 4 spaces matches `core.autocrlf=input` / `editorconfig`-style
/// defaults and aligns with Rust's `rustfmt` baseline.
fn default_tab_size() -> u8 {
    4
}

fn default_true() -> bool {
    true
}
