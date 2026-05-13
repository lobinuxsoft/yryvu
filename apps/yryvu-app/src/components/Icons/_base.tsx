// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared scaffolding for the inline-SVG icon components.
 *
 * All icons in this directory render through `base(...)` so the
 * 16×16 viewBox, `currentColor`-driven stroke, and standard stroke
 * attributes live in one place. Individual icons just supply the path
 * geometry.
 */

import type { JSX } from "solid-js";

export type IconProps = JSX.SvgSVGAttributes<SVGSVGElement>;

export function base(children: JSX.Element, extra?: IconProps): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...extra}
    >
      {children}
    </svg>
  );
}
