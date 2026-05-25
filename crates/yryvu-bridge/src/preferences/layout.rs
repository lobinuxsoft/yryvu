// SPDX-License-Identifier: AGPL-3.0-or-later

//! Layout preferences (issue #134, PR1 panel chrome). Stores the
//! per-profile size + visibility of resizable panels so the user's
//! sizing choices survive app restart.
//!
//! Mirrors GK's `layout.DetailPanel = { width, height, open }` profile
//! setting (audit doc `01-panel-chrome.md`). Today only the right-side
//! inspector lives here; other resizable panels (left sidebar #36)
//! will join this struct as they land.
//!
//! Lives in its own module so the top-level [`super::Preferences`]
//! envelope doesn't grow past the per-file budget.

use serde::{Deserialize, Serialize};

/// Right-side inspector panel sizing + visibility. Width/height in
/// CSS pixels. GK defaults verbatim per audit doc 01.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailPanelLayout {
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default = "default_open")]
    pub open: bool,
}

impl Default for DetailPanelLayout {
    fn default() -> Self {
        Self {
            width: default_width(),
            height: default_height(),
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
}

fn default_width() -> u32 {
    400
}

fn default_height() -> u32 {
    386
}

fn default_open() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_gk() {
        let layout = DetailPanelLayout::default();
        assert_eq!(layout.width, 400);
        assert_eq!(layout.height, 386);
        assert!(layout.open);
    }

    #[test]
    fn serde_roundtrip_preserves_fields() {
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
    fn serde_camel_case_on_wire() {
        let json = serde_json::to_string(&DetailPanelLayout::default()).unwrap();
        // No snake_case escapes onto the wire — keeps the IPC contract
        // aligned with the rest of the preferences sections.
        assert!(!json.contains("detail_panel"));
    }

    #[test]
    fn partial_json_uses_defaults() {
        let parsed: DetailPanelLayout = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed, DetailPanelLayout::default());
    }

    #[test]
    fn envelope_default_nests_detail_panel_default() {
        let prefs = LayoutPreferences::default();
        assert_eq!(prefs.detail_panel, DetailPanelLayout::default());
    }
}
