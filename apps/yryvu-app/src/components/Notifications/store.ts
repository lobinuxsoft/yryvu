// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import { preferences } from "../../state/preferences";
import {
  DURATION_MS,
  type DismissMode,
  type Duration,
  type NotificationCategory,
  type NotificationItem,
  type NotificationOptions,
  type Severity,
} from "./types";

/**
 * Hard cap on simultaneous toasts. Matches GitKraken's
 * `slice(0, 20)` reducer in the toast lib (`/tmp/gk-bundle-pretty.js:156983`).
 * History does not share this cap.
 */
const MAX_ACTIVE_TOASTS = 20;

/**
 * Default duration depends on severity. GK auto-dismisses info/success
 * toasts with `SHORT=5s` and pins error/loading via `FOREVER`.
 */
function defaultDurationFor(severity: Severity): Duration {
  switch (severity) {
    case "error":
    case "loading":
      return "forever";
    case "info":
    case "success":
      return "short";
  }
}

function defaultDismissableFor(severity: Severity): DismissMode {
  // GK uses `X_ONLY` for severe errors; we extend that to all errors and
  // loadings so the user has to acknowledge them explicitly.
  return severity === "error" || severity === "loading" ? "x-only" : "default";
}

/**
 * Sentinel id returned when a toast is gated out by
 * `NotificationsPreferences` (issue #334). Callers that hold the id
 * to dismiss later (typical for `loading` flows) treat the empty
 * string as "nothing to dismiss" — `dismissToast("")` is a no-op.
 */
const GATED_ID = "";

/**
 * True when this notification should be suppressed under the user's
 * `NotificationsPreferences`. `loading` severity bypasses gating
 * because it carries progress signal the user explicitly asked for;
 * a toast without a `category` is always emitted (legacy / one-off
 * callers); a not-yet-loaded preferences resource passes through.
 */
function isGatedOut(severity: Severity, category?: NotificationCategory): boolean {
  if (severity === "loading") return false;
  if (!category) return false;
  const prefs = preferences();
  if (!prefs) return false;
  const field = `${category}Notifications` as const;
  return prefs.notifications[field] === false;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `n${Date.now().toString(36)}-${idCounter}`;
}

const [activeInternal, setActiveInternal] = createSignal<NotificationItem[]>([]);
const [historyInternal, setHistoryInternal] = createSignal<NotificationItem[]>([]);

/** Active toasts shown in the corner stack (newest first). */
export const activeToasts = activeInternal;
/** Full history, newest first. Persists across toast dismissal. */
export const history = historyInternal;

/** Count of unread history entries. Drives the bell icon badge. */
export function unreadCount(): number {
  let n = 0;
  for (const item of historyInternal()) if (!item.read) n += 1;
  return n;
}

/**
 * Push a notification. Returns the new id so callers can reference it
 * later — typical use is `loading` toasts that get replaced by a
 * `success` once the work completes.
 */
export function notify(
  severity: Severity,
  title: string,
  opts: NotificationOptions = {},
): string {
  if (isGatedOut(severity, opts.category)) return GATED_ID;

  const id = nextId();
  const item: NotificationItem = {
    id,
    severity,
    title,
    message: opts.message,
    actions: opts.actions ?? [],
    duration: opts.duration ?? defaultDurationFor(severity),
    dismissable: opts.dismissable ?? defaultDismissableFor(severity),
    category: opts.category,
    createdAt: Date.now(),
    read: false,
  };

  setActiveInternal((prev) => {
    const next = [item, ...prev];
    return next.length > MAX_ACTIVE_TOASTS ? next.slice(0, MAX_ACTIVE_TOASTS) : next;
  });
  // chajá deviation from GK: toasts also seed the history panel so the
  // bell icon has something to show. GK's toasts are ephemeral; their
  // history is fed by a server WebSocket (irrelevant for chajá today).
  setHistoryInternal((prev) => [item, ...prev]);

  return id;
}

/** Dismiss a toast (history entry stays). */
export function dismissToast(id: string): void {
  setActiveInternal((prev) => prev.filter((t) => t.id !== id));
}

/** Drop every visible toast at once. History is untouched. */
export function dismissAllToasts(): void {
  setActiveInternal([]);
}

/** Mark a single history entry as read. */
export function markRead(id: string): void {
  setHistoryInternal((prev) =>
    prev.map((item) => (item.id === id && !item.read ? { ...item, read: true } : item)),
  );
}

/** Mark every history entry as read — used when the panel opens. */
export function markAllRead(): void {
  setHistoryInternal((prev) =>
    prev.some((item) => !item.read) ? prev.map((item) => ({ ...item, read: true })) : prev,
  );
}

/** Drop every history entry. Active toasts are untouched. */
export function clearHistory(): void {
  setHistoryInternal([]);
}

/** Drop a specific history entry. Active toast (if any) is untouched. */
export function removeHistoryEntry(id: string): void {
  setHistoryInternal((prev) => prev.filter((item) => item.id !== id));
}

/** Resolve a duration alias to a finite millisecond count, or `Infinity`. */
export function durationMs(duration: Duration): number {
  return typeof duration === "number" ? duration : DURATION_MS[duration];
}
