// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Preferences-window section glyphs (issue #136). 1:1 mapping to
 * GK's `labelAndIconByTabType` (FontAwesome) rendered as minimal SVG
 * silhouettes.
 */

import { base, type IconProps } from "./_base";

export const IconCode = (p?: IconProps) =>
  base(
    <>
      <path d="M5 4.5L1.5 8 5 11.5" />
      <path d="M11 4.5L14.5 8 11 11.5" />
    </>,
    p,
  );

export const IconText = (p?: IconProps) =>
  base(
    <>
      <path d="M3 4h10" />
      <path d="M3 8h10" />
      <path d="M3 12h6" />
    </>,
    p,
  );

export const IconFlask = (p?: IconProps) =>
  base(
    <>
      <path d="M6.5 1.5v4l-3 7a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5l-3-7v-4" />
      <path d="M5.5 1.5h5" />
      <path d="M4.5 9.5h7" />
    </>,
    p,
  );

export const IconKey = (p?: IconProps) =>
  base(
    <>
      <circle cx="5" cy="11" r="2.5" />
      <path d="M6.8 9.2l6.7-6.7" />
      <path d="M11 5l1.5 1.5" />
    </>,
    p,
  );

export const IconPlug = (p?: IconProps) =>
  base(
    <>
      <path d="M6 1.5v3" />
      <path d="M10 1.5v3" />
      <rect x="4.5" y="4.5" width="7" height="5" rx="0.5" />
      <path d="M8 9.5v3" />
      <path d="M5.5 14.5h5" />
    </>,
    p,
  );

export const IconPuzzle = (p?: IconProps) =>
  base(
    <path d="M2.5 6.5v-3a1 1 0 0 1 1-1h3v1.5a1 1 0 1 0 2 0V2.5h3a1 1 0 0 1 1 1v3h-1.5a1 1 0 1 0 0 2h1.5v3a1 1 0 0 1-1 1h-3v-1.5a1 1 0 1 0-2 0v1.5h-3a1 1 0 0 1-1-1v-3h1.5a1 1 0 1 0 0-2z" />,
    p,
  );

export const IconListOl = (p?: IconProps) =>
  base(
    <>
      <path d="M6 4.5h7.5" />
      <path d="M6 8h7.5" />
      <path d="M6 11.5h7.5" />
      <path d="M2 3v3" />
      <path d="M1.5 6.5h1.5" />
      <path d="M1.5 8.5h1.5l-1.5 2h1.5" />
      <path d="M1.5 11.5h1.5v1.5h-1.5z" />
    </>,
    p,
  );

export const IconLayers = (p?: IconProps) =>
  base(
    <>
      <path d="M8 1.5l-6.5 3 6.5 3 6.5-3z" />
      <path d="M1.5 8l6.5 3 6.5-3" />
      <path d="M1.5 11.5l6.5 3 6.5-3" />
    </>,
    p,
  );

export const IconTools = (p?: IconProps) =>
  base(
    <>
      <path d="M10.5 1.5l4 4-2.5 2.5-4-4z" />
      <path d="M8 4l-6 6 2 2 6-6" />
      <path d="M11 12l1 1 1.5-1.5-1-1" />
    </>,
    p,
  );

export const IconPalette = (p?: IconProps) =>
  base(
    <>
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 1.3 1.3 0 0 0 1-2.2c-.4-.5-.4-1.3.2-1.7.4-.3 1-.4 1.5-.4h1A2.8 2.8 0 0 0 14.5 7C14 4 11.3 1.5 8 1.5z" />
      <circle cx="5" cy="6.5" r="0.8" fill="currentColor" />
      <circle cx="8" cy="4.5" r="0.8" fill="currentColor" />
      <circle cx="11" cy="6.5" r="0.8" fill="currentColor" />
    </>,
    p,
  );
