// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { Label, UserInfo } from "../../ipc";
import { Tooltip } from "../Tooltip";

/// Heuristic luminance pick so the chip text stays legible against
/// the label's background colour. WCAG would have us compute the
/// proper sRGB → relative-luminance formula, but a fast YIQ approx
/// is good enough for our 6-digit hex palette.
function isDarkBg(hex: string): boolean {
  if (hex.length !== 6) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return true;
  // YIQ luma; threshold 128 is the standard split for dark/light.
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

interface LabelChipProps {
  label: Label;
}

export function LabelChip(props: LabelChipProps) {
  const label = () => props.label;
  return (
    <Tooltip text={label().name}>
      <span
        class="sidebar__pr-label-chip"
        data-dark={isDarkBg(label().color) ? "true" : "false"}
        style={{ "background-color": `#${label().color}` }}
      >
        {label().name}
      </span>
    </Tooltip>
  );
}

interface LabelChipsProps {
  labels: Label[];
  /// Maximum labels rendered before collapsing the tail into a `+N`
  /// overflow badge.
  max?: number;
}

export function LabelChips(props: LabelChipsProps) {
  const max = () => props.max ?? 3;
  const visible = () => props.labels.slice(0, max());
  const overflow = () => Math.max(0, props.labels.length - max());
  return (
    <Show when={props.labels.length > 0}>
      <span class="sidebar__pr-chip-group" data-kind="labels">
        <For each={visible()}>{(l) => <LabelChip label={l} />}</For>
        <Show when={overflow() > 0}>
          <span class="sidebar__pr-chip-overflow">+{overflow()}</span>
        </Show>
      </span>
    </Show>
  );
}

interface UserAvatarClusterProps {
  users: UserInfo[];
  kind: "assignees" | "reviewers";
  max?: number;
}

export function UserAvatarCluster(props: UserAvatarClusterProps) {
  const max = () => props.max ?? 3;
  const visible = () => props.users.slice(0, max());
  const overflow = () => Math.max(0, props.users.length - max());
  return (
    <Show when={props.users.length > 0}>
      <Tooltip text={props.users.map((u) => u.login).join(", ")}>
      <span
        class="sidebar__pr-avatar-cluster"
        data-kind={props.kind}
      >
        <For each={visible()}>
          {(u) => (
            <img
              class="sidebar__pr-avatar-cluster__avatar"
              src={u.avatarUrl}
              alt={u.login}
              loading="lazy"
            />
          )}
        </For>
        <Show when={overflow() > 0}>
          <span class="sidebar__pr-chip-overflow">+{overflow()}</span>
        </Show>
      </span>
      </Tooltip>
    </Show>
  );
}
