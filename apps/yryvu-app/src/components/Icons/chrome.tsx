// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * UI chrome icons: app shell affordances (gear, terminal, monitor),
 * navigation glyphs (chevron, open-folder), and surface markers (bell,
 * archive, users group). Not domain-specific to Git.
 */

import { base, type IconProps } from "./_base";

export const IconUsers = (p?: IconProps) =>
  base(
    <>
      <circle cx="5.5" cy="5.5" r="2.2" />
      <path d="M1.5 13c0-2.3 1.8-4 4-4s4 1.7 4 4" />
      <path d="M10.5 7.5a2 2 0 0 0 0-3.8" />
      <path d="M14.5 12.5c0-1.7-1-3.1-2.5-3.7" />
    </>,
    p,
  );

export const IconArchive = (p?: IconProps) =>
  base(
    <>
      <path d="M2 4h12v2H2z" fill="currentColor" stroke="none" opacity="0.25" />
      <rect x="2" y="3.5" width="12" height="2.5" rx="0.5" />
      <path d="M3 6.5v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-6" />
      <path d="M6.5 9h3" />
    </>,
    p,
  );

export const IconTerminal = (p?: IconProps) =>
  base(
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.2" />
      <path d="M4 6l2.5 2L4 10" />
      <path d="M8 10.5h4" />
    </>,
    p,
  );

export const IconGear = (p?: IconProps) =>
  base(
    <>
      {/* 6-tooth gear: outer cog ring + inner hub. Filled tooth shapes
          with a transparent inner ring read clearly at 14 px. */}
      <path d="M8 1.5l1.1 1.6 2-.4.4 2 1.6 1.1-1 1.7 1 1.7-1.6 1.1-.4 2-2-.4L8 14.5l-1.1-1.6-2 .4-.4-2-1.6-1.1 1-1.7-1-1.7 1.6-1.1.4-2 2 .4z" />
      <circle cx="8" cy="8" r="2.5" fill="var(--bg-1)" />
    </>,
    p,
  );

export const IconChevronDown = (p?: IconProps) =>
  base(<path d="M4 6l4 4 4-4" />, p);

export const IconOpenFolder = (p?: IconProps) =>
  base(
    <path d="M1.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z" />,
    p,
  );

/** Monitor / worktree indicator. Marks a ref that has a worktree mounted
 * (the active checkout) — GK paints a small monitor glyph on the right
 * side of pills that own a workdir. */
export const IconMonitor = (p?: IconProps) =>
  base(
    <>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M5.5 13.5h5" />
      <path d="M8 11v2.5" />
    </>,
    p,
  );

/** Notification bell. Used by the Notifications surface. */
export const IconBell = (p?: IconProps) =>
  base(
    <>
      <path d="M3.5 11.5h9l-1-1.5v-3a3.5 3.5 0 0 0-7 0v3z" />
      <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </>,
    p,
  );
