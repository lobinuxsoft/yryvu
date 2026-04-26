// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";

import { IconBell } from "../Icons";
import { HistoryPanel } from "./HistoryPanel";
import { unreadCount } from "./store";

/**
 * Bell icon that doubles as the toolbar trigger for the history panel.
 * The icon tilts -8° while there are unread items (matches GK's
 * `/tmp/gk-bundle-pretty.js:224285-224329`); the badge caps at "50+".
 */
export function Bell() {
  const [open, setOpen] = createSignal(false);
  const count = () => unreadCount();
  const badgeText = () => {
    const n = count();
    if (n === 0) return "";
    return n > 50 ? "50+" : String(n);
  };

  return (
    <div class="notif-bell-wrapper">
      <button
        type="button"
        class="notif-bell"
        classList={{ "notif-bell--unread": count() > 0 }}
        aria-label="Notifications"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        <span class="notif-bell__icon">
          <IconBell />
        </span>
        <Show when={count() > 0}>
          <span class="notif-bell__badge" aria-hidden="true">
            {badgeText()}
          </span>
        </Show>
      </button>
      <Show when={open()}>
        <HistoryPanel onClose={() => setOpen(false)} />
      </Show>
    </div>
  );
}
