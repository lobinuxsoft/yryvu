// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Notification severity levels — 1:1 with GitKraken's set in
 * `/tmp/gk-bundle-pretty.js:331499-331526` (no `warning` in GK; we
 * follow the 4-level taxonomy on purpose to keep the API tight).
 */
export type Severity = "info" | "success" | "error" | "loading";

/**
 * Auto-dismiss timing buckets, mirroring GK's named constants. Numeric
 * milliseconds for finite durations; `"forever"` for toasts that stay
 * until the user dismisses them (canonical for `error` severity).
 */
export type Duration = "very-short" | "short" | "default" | "forever" | number;

export const DURATION_MS: Record<Exclude<Duration, number>, number> = {
  "very-short": 3000,
  short: 5000,
  default: 10000,
  forever: Number.POSITIVE_INFINITY,
};

/**
 * How a toast can be closed. `default` accepts any click on the toast
 * body or the X button; `x-only` only honors the X button — used by GK
 * for severe errors so the user has to actively acknowledge them
 * (`/tmp/gk-bundle-pretty.js:85687-85688`, `:85738-85751`).
 */
export type DismissMode = "default" | "x-only";

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotificationOptions {
  /** Optional secondary line under the title. */
  message?: string;
  /** Inline action buttons. Max 2 keeps the toast readable. */
  actions?: NotificationAction[];
  /**
   * Auto-dismiss timing. Defaults to `short` for info/success, `forever`
   * for error/loading (loading toasts are typically dismissed manually
   * once the work completes).
   */
  duration?: Duration;
  /**
   * `default` — any click closes the toast. `x-only` — only the X
   * button closes; ideal for errors the user must read.
   */
  dismissable?: DismissMode;
}

export interface NotificationItem {
  id: string;
  severity: Severity;
  title: string;
  message?: string;
  actions: NotificationAction[];
  duration: Duration;
  dismissable: DismissMode;
  /** Wall-clock millis. Used to sort the history newest-first. */
  createdAt: number;
  /** History bookkeeping; toggled when the user opens the panel. */
  read: boolean;
}
