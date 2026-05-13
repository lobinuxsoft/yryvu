// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Status indicator icons: success / negative / info / alert / loading.
 * Used by toasts, file-status pills, and async-state surfaces.
 */

import { base, type IconProps } from "./_base";

export const IconCheck = (p?: IconProps) =>
  base(<path d="M3.5 8.5L7 12l5.5-7" />, p);

export const IconDashCircle = (p?: IconProps) =>
  base(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M5 8h6" />
    </>,
    p,
  );

export const IconEye = (p?: IconProps) =>
  base(
    <>
      <path d="M1.5 8s2.5-5 6.5-5 6.5 5 6.5 5-2.5 5-6.5 5-6.5-5-6.5-5z" />
      <circle cx="8" cy="8" r="2" />
    </>,
    p,
  );

export const IconInfo = (p?: IconProps) =>
  base(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4" />
      <path d="M8 5v.5" />
    </>,
    p,
  );

export const IconAlertCircle = (p?: IconProps) =>
  base(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5" />
      <path d="M8 11v.5" />
    </>,
    p,
  );

/** Spinner glyph. Pair with `animation: spin 1s linear infinite;` in
 * the consumer's CSS to make it actually spin (the icon itself is a
 * partial circle). */
export const IconSpinner = (p?: IconProps) =>
  base(<path d="M8 2a6 6 0 1 1-6 6" />, p);
