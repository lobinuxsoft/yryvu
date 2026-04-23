// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import type { HostingService } from "../../../ipc";

/**
 * HTML-plain avatar for the right-panel commit blocks. Shares the URL
 * resolution logic with `CommitGraph/RowRenderer.tsx`'s `CommitAvatar`
 * (GitHub CDN → noreply GitHub → Gravatar) but renders a `<div>` with an
 * `<img>` overlay instead of an SVG, since the inspector doesn't live
 * inside the graph canvas.
 *
 * Two sizes per GitKraken doc 04:
 * - 40 px for author/committer rows
 * - 20 px for co-author chips
 *
 * Initials fallback stays visible under the image; the image fades in
 * with `onload` and never appears if the network request fails (avoids
 * WebKit's flaky SVG `onerror` semantics, same pattern as the SVG version).
 */
export function InspectorAvatar(props: {
  email: string;
  initials: string;
  gravatarHash: string;
  hostingService: HostingService;
  size: 40 | 20;
}) {
  const [loaded, setLoaded] = createSignal(false);

  const avatarUrl = () => {
    const size = props.size * 2;
    if (props.hostingService === "github") {
      return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(
        props.email,
      )}&s=${size}`;
    }
    const noreply = /^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec(
      props.email,
    );
    if (noreply && noreply[1]) {
      return `https://github.com/${noreply[1]}.png?size=${size}`;
    }
    return `https://gravatar.com/avatar/${props.gravatarHash}?s=${size}&d=404`;
  };

  return (
    <span
      class="inspector-avatar"
      classList={{
        "inspector-avatar--40": props.size === 40,
        "inspector-avatar--20": props.size === 20,
      }}
      aria-hidden="true"
    >
      <span class="inspector-avatar__initials">{props.initials}</span>
      <img
        class="inspector-avatar__image"
        classList={{ "is-loaded": loaded() }}
        src={avatarUrl()}
        alt=""
        onLoad={() => setLoaded(true)}
        referrerPolicy="no-referrer"
      />
    </span>
  );
}
