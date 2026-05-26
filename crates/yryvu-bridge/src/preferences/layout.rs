// SPDX-License-Identifier: AGPL-3.0-or-later

//! Layout preferences (issues #134 PR1 + #36). Stores the per-profile
//! size + visibility of resizable shell panels so the user's sizing
//! choices survive app restart.
//!
//! Mirrors GK's `layout.{DetailPanel, RefPanel}` profile settings:
//! - [`DetailPanelLayout`] — right-side inspector (audit doc
//!   `gitkraken-right-panel/01-panel-chrome.md`).
//! - [`LeftSidebarLayout`] — left sidebar (audit doc
//!   `gitkraken-left-panel/00-overview.md`). GK persists this under
//!   the legacy `RefPanel` key; Yryvu uses the descriptive
//!   `leftSidebar` name on the wire.
//!
//! Lives in its own module so the top-level [`super::Preferences`]
//! envelope doesn't grow past the per-file budget.

use serde::{Deserialize, Serialize};

/// Right-side inspector panel sizing + visibility. Width/height in
/// CSS pixels. GK defaults verbatim per audit doc 01.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailPanelLayout {
    #[serde(default = "detail_panel_default_width")]
    pub width: u32,
    #[serde(default = "detail_panel_default_height")]
    pub height: u32,
    #[serde(default = "default_open")]
    pub open: bool,
}

impl Default for DetailPanelLayout {
    fn default() -> Self {
        Self {
            width: detail_panel_default_width(),
            height: detail_panel_default_height(),
            open: default_open(),
        }
    }
}

/// Left sidebar sizing + visibility. Width in CSS pixels. Default 215px
/// per audit doc `gitkraken-left-panel/00-overview.md` (line 216,
/// `RefPanel: { height:300, open:!0, width:215 }`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LeftSidebarLayout {
    #[serde(default = "left_sidebar_default_width")]
    pub width: u32,
    #[serde(default = "default_open")]
    pub open: bool,
}

impl Default for LeftSidebarLayout {
    fn default() -> Self {
        Self {
            width: left_sidebar_default_width(),
            open: default_open(),
        }
    }
}

/// Layout preferences envelope. Wraps every resizable-panel state so
/// they all hydrate / persist through a single serde round-trip.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPreferences {
    #[serde(default)]
    pub detail_panel: DetailPanelLayout,
    #[serde(default)]
    pub left_sidebar: LeftSidebarLayout,
}

fn detail_panel_default_width() -> u32 {
    400
}

fn detail_panel_default_height() -> u32 {
    386
}

fn left_sidebar_default_width() -> u32 {
    215
}

fn default_open() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detail_panel_defaults_match_gk() {
        let layout = DetailPanelLayout::default();
        assert_eq!(layout.width, 400);
        assert_eq!(layout.height, 386);
        assert!(layout.open);
    }

    #[test]
    fn left_sidebar_defaults_match_gk() {
        let layout = LeftSidebarLayout::default();
        assert_eq!(layout.width, 215);
        assert!(layout.open);
    }

    #[test]
    fn detail_panel_serde_roundtrip_preserves_fields() {
        let layout = DetailPanelLayout {
            width: 512,
            height: 720,
            open: false,
        };
        let json = serde_json::to_string(&layout).unwrap();
        let parsed: DetailPanelLayout = serde_json::from_str(&json).unwrap();
        assert_eq!(layout, parsed);
    }

    #[test]
    fn left_sidebar_serde_roundtrip_preserves_fields() {
        let layout = LeftSidebarLayout {
            width: 320,
            open: false,
        };
        let json = serde_json::to_string(&layout).unwrap();
        let parsed: LeftSidebarLayout = serde_json::from_str(&json).unwrap();
        assert_eq!(layout, parsed);
    }

    #[test]
    fn envelope_serde_camel_case_on_wire() {
        let json = serde_json::to_string(&LayoutPreferences::default()).unwrap();
        // No snake_case escapes onto the wire — keeps the IPC contract
        // aligned with the rest of the preferences sections.
        assert!(!json.contains("detail_panel"));
        assert!(!json.contains("left_sidebar"));
    }

    #[test]
    fn partial_json_uses_defaults() {
        let parsed: DetailPanelLayout = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed, DetailPanelLayout::default());

        let parsed: LeftSidebarLayout = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed, LeftSidebarLayout::default());
    }

    #[test]
    fn envelope_default_nests_per_panel_defaults() {
        let prefs = LayoutPreferences::default();
        assert_eq!(prefs.detail_panel, DetailPanelLayout::default());
        assert_eq!(prefs.left_sidebar, LeftSidebarLayout::default());
    }
}
