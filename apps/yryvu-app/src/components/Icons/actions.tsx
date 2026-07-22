// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Toolbar / action icons: undo, redo, arrows, stash in/out, refresh,
 * plus, close, search, filter, pin, star. Generally bound to a button
 * or a keyboard shortcut.
 */

import { base, type IconProps } from "./_base";

export const IconUndo = (p?: IconProps) =>
  base(
    <>
      <path d="M4 6h6a3.5 3.5 0 0 1 0 7H6" />
      <path d="M4 6l2.5-2.5" />
      <path d="M4 6l2.5 2.5" />
    </>,
    p,
  );

export const IconRedo = (p?: IconProps) =>
  base(
    <>
      <path d="M12 6H6a3.5 3.5 0 0 0 0 7h4" />
      <path d="M12 6l-2.5-2.5" />
      <path d="M12 6l-2.5 2.5" />
    </>,
    p,
  );

export const IconArrowDown = (p?: IconProps) =>
  base(
    <>
      <path d="M8 2v11" />
      <path d="M3.5 8.5L8 13l4.5-4.5" />
    </>,
    p,
  );

export const IconArrowUp = (p?: IconProps) =>
  base(
    <>
      <path d="M8 14V3" />
      <path d="M3.5 7.5L8 3l4.5 4.5" />
    </>,
    p,
  );

export const IconStashIn = (p?: IconProps) =>
  base(
    <>
      <rect x="2.5" y="8.5" width="11" height="5" rx="0.8" />
      <path d="M8 2v5" />
      <path d="M5.5 4.5L8 7l2.5-2.5" />
    </>,
    p,
  );

export const IconStashOut = (p?: IconProps) =>
  base(
    <>
      <rect x="2.5" y="8.5" width="11" height="5" rx="0.8" />
      <path d="M8 7V2" />
      <path d="M5.5 4.5L8 2l2.5 2.5" />
    </>,
    p,
  );

export const IconSearch = (p?: IconProps) =>
  base(
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3 3" />
    </>,
    p,
  );

export const IconPlus = (p?: IconProps) =>
  base(
    <>
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </>,
    p,
  );

export const IconStar = (p?: IconProps) =>
  base(
    <path d="M8 2l1.8 3.8 4.2.6-3 3 .7 4.1L8 11.6 4.3 13.5 5 9.4l-3-3 4.2-.6z" />,
    p,
  );

export const IconRefresh = (p?: IconProps) =>
  base(
    <>
      <path d="M13 4a5 5 0 1 0 1.3 5" />
      <path d="M13 2v3h-3" />
    </>,
    p,
  );

export const IconPin = (p?: IconProps) =>
  base(
    <>
      <path d="M9.5 1.5l5 5-2 2-3-1-2.5 2.5L8 11l-1.5 1.5L4 10l1.5-1.5 1 1L9 7l-1-3z" />
      <path d="M5.5 11.5L2 14.5" />
    </>,
    p,
  );

export const IconClose = (p?: IconProps) =>
  base(
    <>
      <path d="M3.5 3.5l9 9" />
      <path d="M12.5 3.5l-9 9" />
    </>,
    p,
  );

export const IconFilter = (p?: IconProps) =>
  base(<path d="M2 3h12l-4.5 5.5v4l-3 1.5v-5.5z" />, p);

export const IconTrash = (p?: IconProps) =>
  base(
    <>
      <path d="M2.5 4h11" />
      <path d="M6 4V2.5h4V4" />
      <path d="M3.5 4l.7 9a1 1 0 0 0 1 .95h5.6a1 1 0 0 0 1-.95l.7-9" />
      <path d="M6.5 6.5v5" />
      <path d="M9.5 6.5v5" />
    </>,
    p,
  );

/// Filename-sort direction toggle. Mirrors GitKraken's
/// `far/sort-alpha-up` ↔ `far/sort-alpha-down` pair: the arrow shows the
/// direction, the bars show that the key is the name.
export const IconSortAsc = (p?: IconProps) =>
  base(
    <>
      <path d="M4 13V3" />
      <path d="M1.5 5.5L4 3l2.5 2.5" />
      <path d="M9 4.5h5" />
      <path d="M9 8h4" />
      <path d="M9 11.5h3" />
    </>,
    p,
  );

export const IconSortDesc = (p?: IconProps) =>
  base(
    <>
      <path d="M4 3v10" />
      <path d="M1.5 10.5L4 13l2.5-2.5" />
      <path d="M9 4.5h3" />
      <path d="M9 8h4" />
      <path d="M9 11.5h5" />
    </>,
    p,
  );
