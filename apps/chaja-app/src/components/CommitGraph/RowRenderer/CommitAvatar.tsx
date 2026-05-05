// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";

import type { HostingService } from "../../../ipc";
import {
  avatarStatusByEmail,
  rememberAvatarStatus,
} from "./avatar";
import { laneColor } from "./geometry";

/**
 * Author avatar overlay for a non-merge commit node. Renders a lane-color
 * backdrop + circular-clipped `<image>` over the commit circle. On image
 * load failure (404 / offline / blocked) falls back to a two-letter
 * initials badge with the lane's color as background, matching
 * GitKraken's `getDefaultAvatar` fallback.
 *
 * - Gravatar URL composed from the pre-hashed email (`row.gravatar_hash`).
 *   `d=404` forces Gravatar to 404 when no avatar is registered, so the
 *   onerror path runs instead of getting the default "mystery man" image.
 * - Per-email result cached across all rows (see `avatarStatusByEmail`)
 *   — a second commit by the same author reuses the previous outcome
 *   and skips the image fetch entirely when it already failed.
 */
export function CommitAvatar(props: {
  cx: number;
  cy: number;
  radius: number;
  colorIdx: number;
  authorEmail: string;
  authorInitials: string;
  gravatarHash: string;
  hostingService: HostingService;
}) {
  const cached = avatarStatusByEmail.get(props.authorEmail);
  // `loaded` flips to true on the image element's `load` event. The image
  // starts at opacity 0; if it loads successfully we swap to opacity 1
  // (tapping over the text initials). If it fails — 404, offline, blocked —
  // opacity stays 0 forever and the text stays visible. This sidesteps SVG
  // `onerror` which fires inconsistently across engines / Tauri's WebView.
  const [loaded, setLoaded] = createSignal(cached === false);
  // Resolve the avatar URL, preferring provider-native sources where the
  // repo's hosting service identifies a CDN that resolves email → avatar
  // without API auth. Direct port of GitKraken's `getAvatarFromEmail`
  // (app bundle offset 1508073):
  //
  // 1. **GitHub CDN** (`hostingService === "github"`) — hit
  //    `https://avatars.githubusercontent.com/u/e?email=<email>&s=N`.
  //    This is a CDN endpoint (NOT the API), no auth required, no rate
  //    limit, and GitHub resolves the email against its internal user
  //    database. If no user matches, it returns an identicon (not a 404)
  //    so the initials fallback won't trigger — acceptable: we show an
  //    identicon instead of a letter badge, same as GK.
  // 2. **GitHub noreply email** (any hosting service) — `[id+]user@users
  //    .noreply.github.com`. Extract the username, hit
  //    `https://github.com/<user>.png?size=N` which redirects to the
  //    real avatar. Works even when the repo's main remote isn't
  //    GitHub (e.g., mirrored to GitLab but commits still use GitHub
  //    noreply emails).
  // 3. **Gravatar** — the hash is pre-computed server-side. `d=404`
  //    forces Gravatar to 404 on missing avatars so the initials
  //    fallback shows instead of the default mystery-man.
  const avatarUrl = () => {
    const size = props.radius * 4;
    if (props.hostingService === "github") {
      return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(
        props.authorEmail,
      )}&s=${size}`;
    }
    const noreply = /^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec(
      props.authorEmail,
    );
    if (noreply && noreply[1]) {
      return `https://github.com/${noreply[1]}.png?size=${size}`;
    }
    return `https://gravatar.com/avatar/${props.gravatarHash}?s=${size}&d=404`;
  };
  const bgColor = () => laneColor(props.colorIdx);
  const fontSize = () => `${Math.round(props.radius * 0.95)}px`;
  // Suppress the network request altogether for emails whose avatar
  // already 404'd earlier in the session — saves a useless round-trip.
  const shouldTryImage = () => cached !== true;
  // Two concentric rings separate the avatar from the lane-color backdrop
  // so an avatar whose dominant hue matches the lane doesn't dissolve into
  // it (GitKraken doc 16 reference — visible as a 1-px dark frame around
  // every avatar in their graph). Outer lane-color ring is 1 px wide,
  // inner dark ring is 1 px, avatar is inset by 2 px total from the commit
  // circle's radius.
  const innerRingRadius = () => Math.max(props.radius - 1, 0);
  const avatarRadius = () => Math.max(props.radius - 2, 0);
  return (
    <>
      {/* Outer lane-color disc — forms the 1-px lane-color frame around
          the avatar. */}
      <circle cx={props.cx} cy={props.cy} r={props.radius} fill={bgColor()} />
      {/* Dark separator ring — 1 px, app background colour. Keeps the
          avatar legible when its dominant hue is close to the lane tint
          (the darker gap gives the eye an edge to latch onto). */}
      <circle
        cx={props.cx}
        cy={props.cy}
        r={innerRingRadius()}
        fill="var(--bg-0)"
      />
      {/* Initials text painted unconditionally. The image (below) overlays
          it when loaded; otherwise this shows through as the fallback. */}
      <text
        x={props.cx}
        y={props.cy}
        font-size={fontSize()}
        font-weight="600"
        text-anchor="middle"
        dominant-baseline="central"
        fill="#fff"
        style={{ "user-select": "none", "pointer-events": "none" }}
      >
        {props.authorInitials}
      </text>
      <Show when={shouldTryImage()}>
        <image
          href={avatarUrl()}
          x={props.cx - avatarRadius()}
          y={props.cy - avatarRadius()}
          width={avatarRadius() * 2}
          height={avatarRadius() * 2}
          preserveAspectRatio="xMidYMid slice"
          style={{
            opacity: loaded() ? 1 : 0,
            transition: "opacity 120ms ease-out",
            // CSS clip-path with percentages — relative to the image's
            // own bounding box. Works across every SVG2 renderer; avoids
            // the SVG-attribute `clip-path: circle(Npx at ...)` form
            // which older WebKit treats as invalid syntax.
            "clip-path": "circle(50% at 50% 50%)",
          }}
          on:load={() => {
            rememberAvatarStatus(props.authorEmail, false);
            setLoaded(true);
          }}
          on:error={() => {
            rememberAvatarStatus(props.authorEmail, true);
          }}
        />
      </Show>
    </>
  );
}
