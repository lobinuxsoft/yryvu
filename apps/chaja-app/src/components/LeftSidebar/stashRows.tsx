// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { type StashInfo } from "../../ipc";

interface StashRowProps {
  stash: StashInfo;
  index: number;
}

/// Pull the first line of the stash message — git stash messages are
/// canonically single-line, but a hand-crafted `git stash store -m`
/// can include newlines.
function shortMessage(message: string): string {
  const nl = message.indexOf("\n");
  return nl > 0 ? message.slice(0, nl) : message;
}

/// Relative-time formatter for stash `when` (unix seconds). Same shape
/// as the recent-repos badge in RepoManagementBody — keep both
/// surfaces visually consistent.
function relativeTime(unixSeconds: number): string {
  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (deltaSeconds < 60) return "just now";
  const m = Math.floor(deltaSeconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function StashRow(props: StashRowProps) {
  const stash = () => props.stash;
  // Click is a no-op for v1 — the stash inspector + Apply/Pop/Drop
  // context menu live in #173 and #172. Row presence here lets the
  // user see and filter their stash queue; actions follow.
  return (
    <div
      class="sidebar__branch-row sidebar__row--stash"
      title={`stash@{${props.index}} — ${stash().message}`}
    >
      <span class="sidebar__row-counter">{`@{${props.index}}`}</span>
      <span class="sidebar__branch-name">{shortMessage(stash().message)}</span>
      <Show when={stash().branch_name}>
        <span class="sidebar__row-badge sidebar__row-badge--accent">
          {stash().branch_name}
        </span>
      </Show>
      <span class="sidebar__row-meta">{relativeTime(stash().when)}</span>
    </div>
  );
}
