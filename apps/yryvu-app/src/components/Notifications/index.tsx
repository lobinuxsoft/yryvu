// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Public surface of the notification system. Mount `<ToastContainer />`
 * once at the shell level and `<Bell />` inside the toolbar; everywhere
 * else, call `notify.success(...)` / `notify.error(...)` / etc.
 *
 * Severity rules ship 1:1 with GitKraken's set: `info`, `success`,
 * `error`, `loading`. There is intentionally no `warning`. See
 * `docs/research/gitkraken-notifications/01-anatomy-and-state.md`.
 */

export { Bell } from "./Bell";
export { ToastContainer } from "./ToastContainer";
export type {
  DismissMode,
  Duration,
  NotificationAction,
  NotificationItem,
  NotificationOptions,
  Severity,
} from "./types";
export {
  activeToasts,
  clearHistory,
  dismissAllToasts,
  dismissToast,
  history,
  markAllRead,
  markRead,
  removeHistoryEntry,
  unreadCount,
} from "./store";

import { notify as notifyRaw } from "./store";
import type { NotificationOptions } from "./types";

/**
 * Sugar API mirroring the `toast.<severity>(...)` shape callers expect.
 * Returns the notification id so callers can `dismissToast()` later —
 * useful for `loading` toasts that get replaced once a long op resolves.
 */
export const notify = {
  info: (title: string, opts?: NotificationOptions) =>
    notifyRaw("info", title, opts),
  success: (title: string, opts?: NotificationOptions) =>
    notifyRaw("success", title, opts),
  error: (title: string, opts?: NotificationOptions) =>
    notifyRaw("error", title, opts),
  loading: (title: string, opts?: NotificationOptions) =>
    notifyRaw("loading", title, opts),
};
