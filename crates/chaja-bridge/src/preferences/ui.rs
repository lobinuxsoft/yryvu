// SPDX-License-Identifier: AGPL-3.0-or-later

//! UI preferences (issue #103). Holds the look-and-feel toggles
//! surfaced under `Preferences > UI` plus the chajá-only deviations
//! (`Density`, `AnimationMode`) that don't have a GK analogue.
//!
//! Lives in its own module so the top-level [`super::Preferences`]
//! envelope doesn't grow past the per-file budget as more sections
//! ship.

use serde::{Deserialize, Serialize};

/// UI preferences (issue #103). Theme lands here in #292 (sub-PR A);
/// zoom (#293), density (#294), tooltips/animations (#315 backend, #316 view)
/// follow.
///
/// `theme` is a [`ThemeId`] — any built-in id, custom id, or `"auto"`.
/// `"auto"` resolves at runtime against `prefers-color-scheme`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    #[serde(default = "default_theme")]
    pub theme: ThemeId,
    #[serde(default)]
    pub density: Density,
    #[serde(default = "default_zoom")]
    pub zoom: f32,
    #[serde(default = "default_tooltips_enabled")]
    pub tooltips_enabled: bool,
    #[serde(default = "default_tooltip_delay_ms")]
    pub tooltip_delay_ms: u16,
    #[serde(default)]
    pub animations: AnimationMode,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            density: Density::default(),
            zoom: default_zoom(),
            tooltips_enabled: default_tooltips_enabled(),
            tooltip_delay_ms: default_tooltip_delay_ms(),
            animations: AnimationMode::default(),
        }
    }
}

/// Theme identifier — accepts any built-in id, custom id, or `"auto"`.
/// Validation is loader-side: an unknown id triggers the self-healing
/// fallback chain (see `themes::loader`).
pub type ThemeId = String;

fn default_theme() -> ThemeId {
    "auto".to_string()
}

/// UI zoom factor (issue #293). Ports GK's `ZOOM_FACTORS` ladder
/// (`bundle:256353`): `0.8 / 0.9 / 1.0 / 1.1 / 1.2 / 1.3`. Stored as
/// `f32` to match GK's wire format — value-set validation lives in
/// the UI `<select>` (Preferences panel + status-bar mirror #313),
/// not in the loader. The frontend applies via CSS `zoom` on `:root`
/// (Option B in `docs/research/gitkraken-ui-preferences/05-zoom.md`),
/// reproducing the "scales every surface" behavior of Electron's
/// `webFrame.setZoomFactor` without a `px → rem` codemod.
fn default_zoom() -> f32 {
    1.0
}

/// UI density (issue #294). chajá-only — GK has no density preference;
/// included to match VSCode / IntelliJ genre conventions. Maps to
/// `:root[data-density="<variant>"]` on the frontend, which overrides
/// the geometry tokens (`--row-h`, `--gutter`, paddings) by ~20% in
/// `Compact`. View-side wiring lands in a separate sub-PR — backend
/// only persists the choice.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Density {
    #[default]
    Comfortable,
    Compact,
}

fn default_tooltips_enabled() -> bool {
    true
}

/// Tooltip hover delay default (issue #315). 500 ms matches GK's
/// `tooltipDelay` constant (`bundle:248913`); the panel gates the
/// effective range to 0..2000 ms but the backing field is `u16` so
/// a future range bump up to ~65 s would not require a schema change.
fn default_tooltip_delay_ms() -> u16 {
    500
}

/// Animation policy (issue #315). `System` honors the OS-level
/// `prefers-reduced-motion` query; `Always` and `Never` are explicit
/// overrides. The frontend (sub-PR #316) reads the literal camelCase
/// strings to drive `:root[data-animations]` plus a CSS override block
/// that disables non-spinner transitions when motion is suppressed.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnimationMode {
    Always,
    #[default]
    System,
    Never,
}
