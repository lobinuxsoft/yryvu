// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";

import type { Profile } from "../../ipc";

/// Derive up to two uppercase initials from a display name, falling back
/// to the author email's first letter, then "?".
function initials(profile: Profile): string {
  const source = profile.displayName.trim() || profile.authorName.trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const email = profile.authorEmail.trim();
  return email ? email[0].toUpperCase() : "?";
}

/// Stable hue from the profile id so each avatar keeps a consistent
/// colour across renders without persisting one.
function hue(profile: Profile): number {
  let acc = 0;
  for (const ch of profile.id) acc = (acc * 31 + ch.charCodeAt(0)) % 360;
  return acc;
}

interface ProfileAvatarProps {
  profile: Profile;
  size?: number;
}

/// Square avatar: the profile's `avatar` image when set, otherwise an
/// initials chip tinted by a stable per-id hue.
export function ProfileAvatar(props: ProfileAvatarProps): JSX.Element {
  const px = () => `${props.size ?? 24}px`;
  return (
    <Show
      when={props.profile.avatar}
      fallback={
        <span
          class="profile-avatar profile-avatar--initials"
          style={{
            width: px(),
            height: px(),
            "background-color": `hsl(${hue(props.profile)} 45% 38%)`,
            "font-size": `${(props.size ?? 24) * 0.42}px`,
          }}
          aria-hidden="true"
        >
          {initials(props.profile)}
        </span>
      }
    >
      {(src) => (
        <img
          class="profile-avatar"
          src={src()}
          alt=""
          style={{ width: px(), height: px() }}
        />
      )}
    </Show>
  );
}
