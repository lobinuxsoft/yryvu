<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Theme recipes

Copy-paste starting points. Each is used by a shipped built-in, so it's known
to work against the real chrome. Token reference: [CHEATSHEET](./CHEATSHEET.md).

All snippets go in your theme's `tokens.css` (for `--*` overrides) or
`personality.css` (for decorative rules). Personality selectors are **bare** —
only the active theme's `personality.css` is ever injected, so a plain
`.toolbar { … }` only styles your theme.

---

## Brutalist square shapes

Kill every rounded corner. *(shipped by `f-gruvbox-dark`)*

```css
/* tokens.css */
:root[data-theme="my-theme"] {
  --btn-radius: 1px;
  --pill-radius: 2px;
  --avatar-radius: 2px;
}
```

---

## Cut-corner buttons

Clip the top-left + bottom-right for a beveled look. *(shipped by `h-dracula`)*

```css
:root[data-theme="my-theme"] {
  --btn-clip-path: polygon(
    7px 0, 100% 0, 100% calc(100% - 7px),
    calc(100% - 7px) 100%, 0 100%, 0 7px
  );
}
```

> **Caveat:** `clip-path` on an element also clips absolutely-positioned
> descendants. Yryvu only applies `--btn-clip-path` to leaf buttons (not the
> split-button container, which owns a dropdown) for this reason.

---

## Override an icon

Drop a plain SVG in `icons/<name>.svg` — the backend base64-inlines it into
`--icon-<name>` for you (no hand-encoded data URIs, no CSP fuss). *(shipped by
`d-synthwave/icons/{undo,gear}.svg`)*

```
my-theme/
  theme.toml
  tokens.css
  icons/
    close.svg      → overrides --icon-close
    undo.svg       → overrides --icon-undo
```

Colour is irrelevant inside the SVG (a mask is painted with `currentColor`);
use any opaque fill/stroke. Icon names are listed in the
[CHEATSHEET](./CHEATSHEET.md#icons-300). The recursive file-watcher reloads the
theme when you add or edit an svg.

---

## Neon commit graph

Bigger nodes + thicker edges + lane glows. *(shipped by `d-synthwave`)*

```css
/* tokens.css */
:root[data-theme="my-theme"] {
  --graph-node-radius: 13px;
  --graph-edge-width: 3px;
}
```

```css
/* personality.css — RGB-shift glitch on ref pills */
.ref-pill {
  animation: glitch 4s steps(2, end) infinite;
}
@keyframes glitch {
  61% { filter: drop-shadow(-1px 0 0 var(--accent)) drop-shadow(1px 0 0 var(--info)); }
}
@media (prefers-reduced-motion: reduce) {
  .ref-pill { animation: none; }
}
```

---

## Paper-grain background

Subtle fractal-noise texture via an inline SVG `<feTurbulence>`. *(shipped by
`e-rose-pine-dawn` and `j-kanagawa`)*

```css
/* personality.css */
.cold-start {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)' opacity='0.03'/%3E%3C/svg%3E");
}
```

Keep `opacity` low (`0.02`–`0.05`) — grain over diff/graph text reads as noise
above that.

---

## Custom font swap

Ship a font with the theme and point the UI/mono tokens at it.

```css
/* tokens.css */
@font-face {
  font-family: "My Mono";
  src: url("data:font/woff2;base64,…") format("woff2");
}
:root[data-theme="my-theme"] {
  --font-ui: "My Sans", system-ui, sans-serif;
  --font-mono: "My Mono", ui-monospace, monospace;
  /* or scope one surface: */
  --font-graph-message: "My Serif", Georgia, serif;
}
```

Fonts must be inlined as `data:` URIs (a raw `url("font.woff2")` in injected CSS
won't resolve to the theme folder under the app's CSP — same reason icons are
inlined by the backend).

---

## Glassmorphism toolbar

Translucent toolbar with a backdrop blur.

```css
/* personality.css */
.toolbar {
  background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
```

> **Caveat:** a translucent toolbar over scrolling diff/graph content can hurt
> legibility. Keep the blur high and the transparency modest, and test on a
> busy repo.

---

## Reduced motion

Any theme that animates must degrade gracefully:

```css
@media (prefers-reduced-motion: reduce) {
  .cold-start__title,
  .toolbar,
  .ref-pill {
    animation: none;
  }
}
```
