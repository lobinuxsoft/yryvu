// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Themeable chrome icon. Renders `<span class="icon" data-icon="<name>">`
 * whose shape is a CSS mask driven by `--icon-<name>` and painted with the
 * surrounding `color` (see styles/icons.css + tokens.css).
 *
 * Why a mask instead of the inline-SVG `components/Icons` set: only a
 * CSS-swappable glyph lets a theme override an individual icon's shape —
 * either via `--icon-<name>: url(...)` or by dropping `icons/<name>.svg`
 * in the theme folder (the backend inlines it, #300). Inline SVG stays for
 * graph-embedded geometry and non-control glyphs that aren't themeable.
 *
 * Size defaults to 16px (matches the old icons); `width`/`height` forward
 * to the sized callsites so nothing shrinks or grows across the migration.
 */

import type { JSX } from "solid-js";

interface IconProps {
  /** Icon token name, e.g. "undo", "chevron-down". */
  name: string;
  /** ARIA label. Omit for purely-decorative icons (rendered aria-hidden). */
  label?: string;
  /** Pixel size overrides; default 16×16 from CSS. */
  width?: number | string;
  height?: number | string;
  /** Extra class merged onto `.icon`. */
  class?: string;
}

function px(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return `${v}px`;
  // Bare numeric strings ("10") lost their unit as an SVG attr; a CSS
  // length needs one. Anything already unitful ("1em") passes through.
  return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
}

export function Icon(props: IconProps): JSX.Element {
  // Only `class` drives the class list here (no separate classList), so
  // appending props.class to the static base is safe — nothing to wipe.
  return (
    <span
      class={props.class ? `icon ${props.class}` : "icon"}
      data-icon={props.name}
      role={props.label ? "img" : undefined}
      aria-hidden={props.label ? undefined : true}
      aria-label={props.label}
      style={{ width: px(props.width), height: px(props.height) }}
    />
  );
}
