# 11 — Implementation notes for #103

Concrete plumbing recipes for each yryvu layer. This is the bridge from
the research findings into PR-ready code shapes. Auditor reviews these
before the implementation PRs open.

## Backend recipes

### Extending `UiPreferences`

File: `crates/yryvu-bridge/src/preferences.rs`. The struct currently
sits at line 107 as `pub struct UiPreferences {}`. Replace with:

```rust
/// UI preferences (issue #103). Theme, zoom, density, tooltips,
/// animations.
///
/// Each field is `#[serde(default)]` so partial JSON or older-version
/// files load cleanly. Default values match the design-previews and
/// honor OS hints where available.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    /// Theme id. `Auto` resolves to a dark or light theme at read
    /// time based on `prefers-color-scheme`. See
    /// `docs/research/gitkraken-ui-preferences/01-theme-preference.md`.
    #[serde(default = "default_theme")]
    pub theme: ThemeId,

    /// Window zoom factor. Discrete ladder: 0.8, 0.9, 1.0, 1.1, 1.2,
    /// 1.3 (matches GK `ZOOM_FACTORS` at bundle:256353). Default 1.0.
    #[serde(default = "default_zoom")]
    pub zoom: f32,

    /// UI density. `Comfortable` matches the design-previews; `Compact`
    /// reduces row heights and paddings. See doc 02.
    #[serde(default)]
    pub density: Density,

    /// Show tooltips on hover/focus. When false, tooltips are
    /// suppressed globally. Default true. See doc 03.
    #[serde(default = "default_true")]
    pub tooltips_enabled: bool,

    /// Hover delay before tooltip shows, in milliseconds. Active only
    /// when `tooltips_enabled`. Default 500. See doc 03.
    #[serde(default = "default_tooltip_delay_ms")]
    pub tooltip_delay_ms: u16,

    /// Animation mode. `System` honors `prefers-reduced-motion`.
    /// Default `System`. See doc 04.
    #[serde(default)]
    pub animations: AnimationMode,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeId {
    Auto,
    #[serde(rename = "a-default")]
    ADefault,
    #[serde(rename = "b-tokyo-night")]
    BTokyoNight,
    #[serde(rename = "c-catppuccin-mocha")]
    CCatppuccinMocha,
    #[serde(rename = "d-synthwave")]
    DSynthwave,
    #[serde(rename = "e-rose-pine-dawn")]
    ERosePineDawn,
    #[serde(rename = "f-gruvbox-dark")]
    FGruvboxDark,
    #[serde(rename = "g-nord")]
    GNord,
    #[serde(rename = "h-dracula")]
    HDracula,
    #[serde(rename = "i-everforest-dark")]
    IEverforestDark,
    #[serde(rename = "j-kanagawa")]
    JKanagawa,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Density {
    #[default]
    Comfortable,
    Compact,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnimationMode {
    #[default]
    System,
    Always,
    Never,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            zoom: default_zoom(),
            density: Density::default(),
            tooltips_enabled: true,
            tooltip_delay_ms: default_tooltip_delay_ms(),
            animations: AnimationMode::default(),
        }
    }
}

fn default_theme() -> ThemeId { ThemeId::Auto }
fn default_zoom() -> f32 { 1.0 }
fn default_tooltip_delay_ms() -> u16 { 500 }
fn default_true() -> bool { true }
```

### `Eq` removed from derive

The current `UiPreferences` has `#[derive(Eq)]` (line 105). Removing
that because `f32` is not `Eq`. Keep `PartialEq`. If anything in the
codebase relies on `Eq` for `UiPreferences`, refactor. (Grep first.)

### Validation

Zoom values are not validated server-side — the UI `<select>` constrains
to the 6 allowed values. If a malformed `preferences.json` ships a
zoom of `1.7`, the load succeeds and the value renders as 170%. Future
hardening: clamp to nearest allowed value on load.

### IPC / Tauri commands

No new commands. The existing `preferences::save` / `preferences::load`
handle the struct unchanged.

