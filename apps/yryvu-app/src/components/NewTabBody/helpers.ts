// SPDX-License-Identifier: AGPL-3.0-or-later

/// Port verbatim from gk-bundle render.bundle.js — `at.RECENTLY_OPENED_LIMIT=8`.
/// Audit doc 07, cross-validated against the bundle.
export const RECENTLY_OPENED_LIMIT = 8;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const delta = now - epochMs;
  if (delta < MINUTE_MS) return "just now";
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m ago`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h ago`;
  if (delta < 30 * DAY_MS) return `${Math.floor(delta / DAY_MS)}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

export function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return path.startsWith("/") ? "/" : "";
  return path.slice(0, idx);
}
