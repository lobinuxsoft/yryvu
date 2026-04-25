// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Inline SVG icons. 16×16 viewBox, `currentColor` stroke/fill so the icon
 * inherits the surrounding text color. No runtime deps.
 */

import type { JSX } from "solid-js";

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement>;

function base(children: JSX.Element, extra?: IconProps): JSX.Element {
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

export const IconCheck = (p?: IconProps) =>
  base(
    <path d="M3.5 8.5L7 12l5.5-7" />,
    p,
  );

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

/* ======================================================================= */
/* Toolbar action icons                                                     */
/* ======================================================================= */

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
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5L11 5M5 11l-1.5 1.5" />
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

export const IconChevronDown = (p?: IconProps) =>
  base(<path d="M4 6l4 4 4-4" />, p);

export const IconStar = (p?: IconProps) =>
  base(
    <path d="M8 2l1.8 3.8 4.2.6-3 3 .7 4.1L8 11.6 4.3 13.5 5 9.4l-3-3 4.2-.6z" />,
    p,
  );

export const IconOpenFolder = (p?: IconProps) =>
  base(
    <>
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z" />
    </>,
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
