// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";

import type { HostingService } from "../../../ipc";
import { PALETTE_SIZE } from "./geometry";

/**
 * Per-email cache of avatar load results. Prevents reissuing network
 * requests for emails that already 404'd on Gravatar (there's no point
 * trying again within a session — Gravatar caches aggressively and a
 * missing avatar on page 1 stays missing on page 40). Bound to an
 * upper ceiling so long-history repos don't leak; simple FIFO eviction
 * is sufficient — ordering within the cache doesn't matter for
 * correctness.
 *
 * `true`  → we've seen a 404 / network error for this email
 * `false` → we've successfully loaded the avatar
 * absent  → not tried yet (render optimistically, cache the outcome)
 */
const AVATAR_CACHE_CAP = 512;
export const avatarStatusByEmail = new Map<string, boolean>();

export function rememberAvatarStatus(email: string, failed: boolean) {
  if (
    avatarStatusByEmail.size >= AVATAR_CACHE_CAP &&
    !avatarStatusByEmail.has(email)
  ) {
    // Evict the oldest insertion (Map iteration preserves insertion order in JS).
    const firstKey = avatarStatusByEmail.keys().next().value;
    if (firstKey !== undefined) avatarStatusByEmail.delete(firstKey);
  }
  avatarStatusByEmail.set(email, failed);
}

/**
 * Resolve the best avatar URL for an author email. Shared by the
 * SVG `CommitAvatar` (graph zone) and the HTML `AuthorBadge` (author
 * column icon-only mode) so the same image gets cache-hit by the
 * browser the second time around.
 *
 * Provider preference matches GK (`getAvatarFromEmail`, app bundle):
 *   1. github CDN email endpoint when the repo's primary remote is GH;
 *   2. github noreply email → `github.com/<user>.png`;
 *   3. gravatar with `d=404` so misses fall back to initials.
 */
export function resolveAvatarUrl(
  email: string,
  gravatarHash: string,
  hostingService: HostingService,
  diameterPx: number,
): string {
  if (hostingService === "github") {
    return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(
      email,
    )}&s=${diameterPx}`;
  }
  const noreply = /^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec(
    email,
  );
  if (noreply && noreply[1]) {
    return `https://github.com/${noreply[1]}.png?size=${diameterPx}`;
  }
  return `https://gravatar.com/avatar/${gravatarHash}?s=${diameterPx}&d=404`;
}

/**
 * HTML-friendly author avatar badge — used by the Author column in
 * icon-only mode. Mirrors `CommitAvatar`'s URL resolution and 404
 * cache so the image is loaded once per email and reused everywhere.
 */
export function AuthorBadge(props: {
  authorEmail: string;
  authorInitials: string;
  gravatarHash: string;
  hostingService: HostingService;
  colorIdx: number;
}) {
  const cached = avatarStatusByEmail.get(props.authorEmail);
  const [loaded, setLoaded] = createSignal(cached === false);
  const url = () =>
    resolveAvatarUrl(
      props.authorEmail,
      props.gravatarHash,
      props.hostingService,
      44,
    );
  return (
    <span
      class="author-badge"
      style={{
        background: `var(--column-${props.colorIdx % PALETTE_SIZE}-color)`,
      }}
    >
      <span class="author-badge__initials">{props.authorInitials}</span>
      <Show when={cached !== true}>
        <img
          class="author-badge__img"
          src={url()}
          alt=""
          style={{ opacity: loaded() ? 1 : 0 }}
          onLoad={() => {
            rememberAvatarStatus(props.authorEmail, false);
            setLoaded(true);
          }}
          onError={() => {
            rememberAvatarStatus(props.authorEmail, true);
          }}
        />
      </Show>
    </span>
  );
}
