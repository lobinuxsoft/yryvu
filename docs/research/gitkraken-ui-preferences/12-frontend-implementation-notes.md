# 12 — Frontend implementation notes for #103

Companion to `11-backend-implementation-notes.md`. Solid + CSS layer.

## Frontend recipes

### File layout

```
apps/chaja-app/src/
├── components/PreferencesWindow/panels/Ui.tsx        # MAIN: 5 rows + i18n
├── state/preferences.ts                              # ADD: signals + effects
├── styles/
│   ├── tokens.css                                    # EXIST: density tokens added
│   └── themes.css                                    # NEW: 10 :root[data-theme] blocks
├── components/Tooltip/
│   ├── index.tsx                                     # NEW: <Tooltip> wrapper
│   └── tooltip.css                                   # NEW
└── public/fonts/                                     # NEW: bundled FiraCode (copy from design-previews/preferences-themes/fonts/)
```

### `state/preferences.ts` shape

```ts
import { createSignal, createEffect, createMemo } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { UiPreferences, ThemeId } from "../bindings/types";

// Signals — one per UI setting.
const [theme, setTheme] = createSignal<ThemeId>("auto");
const [zoom, setZoom] = createSignal<number>(1.0);
const [density, setDensity] = createSignal<"comfortable" | "compact">("comfortable");
const [tooltipsEnabled, setTooltipsEnabled] = createSignal<boolean>(true);
const [tooltipDelayMs, setTooltipDelayMs] = createSignal<number>(500);
const [animations, setAnimations] = createSignal<"system" | "always" | "never">("system");

// Resolved theme — `auto` collapses to a-default / e-rose-pine-dawn.
const [osTheme, setOsTheme] = createSignal<"dark" | "light">(
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
  setOsTheme(e.matches ? "dark" : "light");
});
const resolvedTheme = createMemo(() =>
  theme() === "auto"
    ? (osTheme() === "dark" ? "a-default" : "e-rose-pine-dawn")
    : theme(),
);

// Effects — apply to <html> attributes.
createEffect(() => {
  document.documentElement.dataset.theme = resolvedTheme();
});
createEffect(() => {
  document.documentElement.dataset.density = density();
});
createEffect(() => {
  document.documentElement.dataset.animations = animations();
});
createEffect(() => {
  // Option B: CSS zoom. (Migrate to root font-size in a follow-up.)
  document.documentElement.style.zoom = String(zoom());
});

// Persistence — atomic save on any signal change.
let saveTimer: number | undefined;
createEffect(() => {
  // Read all signals to subscribe.
  const snapshot: UiPreferences = {
    theme: theme(),
    zoom: zoom(),
    density: density(),
    tooltipsEnabled: tooltipsEnabled(),
    tooltipDelayMs: tooltipDelayMs(),
    animations: animations(),
  };
  // Debounce 250ms to coalesce rapid changes (e.g. user spinning the zoom select).
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void invoke("preferences_save", { ui: snapshot });
  }, 250);
});

// Initial load.
void invoke<UiPreferences>("preferences_load_ui").then(loaded => {
  setTheme(loaded.theme);
  setZoom(loaded.zoom);
  setDensity(loaded.density);
  setTooltipsEnabled(loaded.tooltipsEnabled);
  setTooltipDelayMs(loaded.tooltipDelayMs);
  setAnimations(loaded.animations);
});

export const ui = {
  theme, zoom, density, tooltipsEnabled, tooltipDelayMs, animations,
  resolvedTheme,
};
export const setUi = {
  setTheme, setZoom, setDensity, setTooltipsEnabled, setTooltipDelayMs, setAnimations,
};
```

(The `preferences_load_ui` and `preferences_save` Tauri commands are
already wired or trivially derive from the existing
`preferences::load` / `preferences::save`. If `preferences_save`
takes the full `Preferences` envelope, the snapshot above needs to
read the rest of the slices too — adapt to the existing shape.)

### `Ui.tsx` panel render

Replace the current placeholder:

```tsx
import type { JSX } from "solid-js";
import { ui, setUi } from "../../../state/preferences";
import { useT } from "../../../i18n";

export function UiPanel(): JSX.Element {
  const t = useT();
  return (
    <div class="settings-group">
      <h3>{t("UiPreferences-Title")}</h3>

      <PreferenceRow label={t("UiPreferences-Theme")}>
        <select value={ui.theme()}
                onChange={e => setUi.setTheme(e.currentTarget.value as never)}>
          <option value="auto">{t("UiPreferences-Theme-Auto")}</option>
          <option value="a-default">a · Default chajá</option>
          <option value="b-tokyo-night">b · Tokyo Night</option>
          <option value="c-catppuccin-mocha">c · Catppuccin Mocha</option>
          <option value="d-synthwave">d · Synthwave</option>
          <option value="e-rose-pine-dawn">e · Rosé Pine Dawn</option>
          <option value="f-gruvbox-dark">f · Gruvbox Dark</option>
          <option value="g-nord">g · Nord</option>
          <option value="h-dracula">h · Dracula</option>
          <option value="i-everforest-dark">i · Everforest Dark</option>
          <option value="j-kanagawa">j · Kanagawa</option>
        </select>
      </PreferenceRow>

      <PreferenceRow label={t("UiPreferences-Zoom")}>
        <select value={ui.zoom()}
                onChange={e => setUi.setZoom(parseFloat(e.currentTarget.value))}>
          <option value="0.8">80%</option>
          <option value="0.9">90%</option>
          <option value="1.0">100%</option>
          <option value="1.1">110%</option>
          <option value="1.2">120%</option>
          <option value="1.3">130%</option>
        </select>
      </PreferenceRow>

      <PreferenceRow label={t("UiPreferences-Density")}>
        <select value={ui.density()}
                onChange={e => setUi.setDensity(e.currentTarget.value as never)}>
          <option value="comfortable">{t("UiPreferences-Density-Comfortable")}</option>
          <option value="compact">{t("UiPreferences-Density-Compact")}</option>
        </select>
      </PreferenceRow>

      <PreferenceRow label={t("UiPreferences-TooltipsEnabled")}>
        <input type="checkbox"
               checked={ui.tooltipsEnabled()}
               onChange={e => setUi.setTooltipsEnabled(e.currentTarget.checked)}/>
      </PreferenceRow>

      <PreferenceRow label={t("UiPreferences-TooltipDelayMs")}
                     disabled={!ui.tooltipsEnabled()}>
        <input type="number" min={0} max={2000} step={50}
               value={ui.tooltipDelayMs()}
               disabled={!ui.tooltipsEnabled()}
               onChange={e => setUi.setTooltipDelayMs(parseInt(e.currentTarget.value, 10))}/>
      </PreferenceRow>

      <PreferenceRow label={t("UiPreferences-Animations")}>
        <select value={ui.animations()}
                onChange={e => setUi.setAnimations(e.currentTarget.value as never)}>
          <option value="system">{t("UiPreferences-Animations-System")}</option>
          <option value="always">{t("UiPreferences-Animations-Always")}</option>
          <option value="never">{t("UiPreferences-Animations-Never")}</option>
        </select>
      </PreferenceRow>
    </div>
  );
}
```

(`PreferenceRow` is a thin wrapper with `<label>` + slot. If chajá
already has a row component, reuse — don't duplicate.)

### `themes.css` shape

Single file, 10 `:root[data-theme="<id>"]` blocks plus the `:root` baseline.

```css
/* Default — a-default */
:root,
:root[data-theme="a-default"] {
  --bg-0: #0f1116;
  --bg-1: #15171d;
  /* ... copy from design-previews/preferences-themes/a-default.html :root block ... */
}

:root[data-theme="b-tokyo-night"] {
  --bg-0: #1a1b26;
  /* ... copy from b-tokyo-night.html ... */
}

/* ... 8 more ... */
```

Cap **400 LOC per file** — if 10 themes blow past 400 LOC, split into
`themes/_common.css` (geometry/typography that's shared) +
`themes/<id>.css` (color tokens only) and `@import` from a single
`themes.css`.

### `tokens.css` density additions

Append to existing `tokens.css`:

```css
/* Density override — compact */
:root[data-density="compact"] {
  /* Geometry */
  --row-h: 22px;
  --toolbar-height: 44px;
  --statusbar-height: 22px;
  --tabs-height: 28px;
  /* Typography */
  font-size: 12px;
}
```

Animation override:

```css
/* Animations off */
:root[data-animations="never"] *,
:root[data-animations="never"] *::before,
:root[data-animations="never"] *::after {
  animation: none !important;
  transition: none !important;
}

/* Honor OS when user picked System */
@media (prefers-reduced-motion: reduce) {
  :root[data-animations="system"] *,
  :root[data-animations="system"] *::before,
  :root[data-animations="system"] *::after {
    animation: none !important;
    transition: none !important;
  }
}

/* Spinner exemption — keep spinning even when animations off */
.loading-spinner {
  animation: spin 1s linear infinite !important;
}
```

### `<Tooltip>` component

```tsx
import { JSX, createSignal, Show, onCleanup } from "solid-js";
import { ui } from "../../state/preferences";

export function Tooltip(props: {
  children: JSX.Element;
  content: string;
  placement?: "top" | "bottom";
}): JSX.Element {
  const enabled = () => ui.tooltipsEnabled();
  const delay = () => ui.tooltipDelayMs();
  const [visible, setVisible] = createSignal(false);
  let timer: number | undefined;

  const show = () => {
    if (!enabled()) return;
    timer = setTimeout(() => setVisible(true), delay());
  };
  const hide = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    setVisible(false);
  };

  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  return (
    <span class="tooltip-trigger"
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}>
      {props.children}
      <Show when={visible() && enabled()}>
        <span class={`tooltip-popover tooltip-${props.placement ?? "top"}`}
              role="tooltip">
          {props.content}
        </span>
      </Show>
    </span>
  );
}
```

When `enabled()` is false, the popover never renders. The `aria-label`
on children continues to be honored by screen readers.

### Migration of existing tooltips

Audit pre-PR:

```bash
grep -rn "title=" apps/chaja-app/src/ | grep -v ".test." | wc -l
```

Each site becomes:

```diff
- <button title="Save the file">save</button>
+ <Tooltip content={t("Action-Save")}>
+   <button>save</button>
+ </Tooltip>
```

(Assuming `aria-label` is added separately on the button.)

## Resource bundling

```json
"bundle": {
  "resources": [
    "fonts/*.ttf",
    "styles/themes/*.css"
  ]
}
```

Already present if chajá bundles fonts elsewhere; add the new paths.

## Test plan

1. Each of 10 themes + auto renders without missing tokens (manual or
   screenshot-diff if available).
2. Switching theme during a graph render does not flicker / re-layout.
3. Zoom 80%/100%/130% all render correctly under each density.
4. `preferences.json` round-trip: save state, edit by hand to add
   unknown field, load — older fields preserved.
5. `prefers-color-scheme` change while `auto` selected: theme switches
   live without app refresh.
6. `prefers-reduced-motion` change while `system` selected: animations
   stop without app refresh.
