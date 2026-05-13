// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Git-domain icons: branches, remotes, pull requests, tags, commit
 * markers. Status indicators (check / dash / alert) live in
 * `./status.tsx`; toolbar actions (stash, undo/redo, arrows) live in
 * `./actions.tsx`.
 */

import { base, type IconProps } from "./_base";

export const IconBranch = (p?: IconProps) =>
  base(
    <>
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="6" r="1.5" />
      <path d="M4 4.5v7" />
      <path d="M4 9c0-2 2-2.5 4-2.5h2.5" />
    </>,
    p,
  );

export const IconCloud = (p?: IconProps) =>
  base(
    <path d="M4.5 12a3 3 0 0 1 .3-5.98 4 4 0 0 1 7.7 1.5A2.5 2.5 0 0 1 12 12z" />,
    p,
  );

export const IconPullRequest = (p?: IconProps) =>
  base(
    <>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="12.5" r="1.5" />
      <path d="M4 5v6" />
      <path d="M12 5.5v5.5" />
      <path d="M12 5.5h-1.5a2 2 0 0 1-2-2V2.5" />
    </>,
    p,
  );

export const IconCircleDot = (p?: IconProps) =>
  base(
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </>,
    p,
  );

export const IconTag = (p?: IconProps) =>
  base(
    <>
      <path d="M2 2.5h5l6.5 6.5a1 1 0 0 1 0 1.4l-3.1 3.1a1 1 0 0 1-1.4 0L2.5 7V2.5z" />
      <circle cx="5" cy="5" r="0.8" fill="currentColor" />
    </>,
    p,
  );

/// Annotated-tag variant — same body as `IconTag` but with three short
/// horizontal "text" strokes overlaid to hint at the tag's message.
/// Distinguishes annotated from lightweight tags in the sidebar list.
export const IconTagAnnotated = (p?: IconProps) =>
  base(
    <>
      <path d="M2 2.5h5l6.5 6.5a1 1 0 0 1 0 1.4l-3.1 3.1a1 1 0 0 1-1.4 0L2.5 7V2.5z" />
      <circle cx="5" cy="5" r="0.8" fill="currentColor" />
      <line x1="6.5" y1="8.2" x2="9.8" y2="8.2" stroke-width="1" />
      <line x1="7" y1="9.8" x2="10.3" y2="9.8" stroke-width="1" />
      <line x1="7.5" y1="11.4" x2="10.8" y2="11.4" stroke-width="1" />
    </>,
    p,
  );

export const IconCodeCommit = (p?: IconProps) =>
  base(
    <>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M1.5 8h3.5" />
      <path d="M11 8h3.5" />
    </>,
    p,
  );
