// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diff view-mode toolbar icons (issue #59).
 *
 * Each glyph mirrors a GitKraken Font Awesome reference from
 * `docs/research/gitkraken-diff/02-view-modes.md` — Phosphor-style
 * equivalents adapted to yryvu's 16x16 stroked-line convention.
 */

import { base, type IconProps } from "./_base";

/// File View — `["fas","file"]` (outer toggle).
export const IconFile = (p?: IconProps) =>
  base(
    <>
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3" />
    </>,
    p,
  );

/// Diff View — abstract Git-diff glyph (outer toggle, no FA exact match).
export const IconDiff = (p?: IconProps) =>
  base(
    <>
      <path d="M5 2v12" />
      <path d="M11 2v12" />
      <path d="M3 5h4" />
      <path d="M3 11h4" />
      <path d="M9 8h4" />
    </>,
    p,
  );

/// Hunk View — `["far","list-alt"]`. Rectangle with bullet rows.
export const IconListAlt = (p?: IconProps) =>
  base(
    <>
      <path d="M1.5 2.5h13v11h-13z" />
      <circle cx="4" cy="6" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="4" cy="10" r="0.6" fill="currentColor" stroke="none" />
      <path d="M6 6h6" />
      <path d="M6 10h6" />
    </>,
    p,
  );

/// Inline View — `["far","list"]`. Plain horizontal lines.
export const IconList = (p?: IconProps) =>
  base(
    <>
      <path d="M3 4h10" />
      <path d="M3 8h10" />
      <path d="M3 12h10" />
    </>,
    p,
  );

/// Split View — `["far","columns"]`. Two columns side-by-side.
export const IconColumns = (p?: IconProps) =>
  base(
    <>
      <path d="M1.5 2.5h13v11h-13z" />
      <path d="M8 2.5v11" />
    </>,
    p,
  );
