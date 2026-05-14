// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Signal } from "solid-js";

/**
 * Shared `localStorage` namespace for every persisted UI signal in the
 * app. Keep the prefix on every read/write so users with multiple yryvu
 * versions co-resident in the same browser profile (rare, but possible
 * during dev) don't trample each other's state.
 */
export const STORAGE_PREFIX = "yryvu.";

/**
 * Persisted boolean signal. Stores `"1"` / `"0"` so the values survive
 * a JSON round-trip-free read; the wrapper setter writes to localStorage
 * before fanning out to subscribers, which means a tab that crashes
 * mid-update still sees the user's intended choice on reload.
 */
export function persistedBool(key: string, fallback: boolean): Signal<boolean> {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  const initial = stored === null ? fallback : stored === "1";
  const [value, setValue] = createSignal(initial);
  const wrapped: Signal<boolean>[1] = ((next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(value()) : next;
    localStorage.setItem(STORAGE_PREFIX + key, resolved ? "1" : "0");
    return setValue(resolved);
  }) as Signal<boolean>[1];
  return [value, wrapped];
}

/**
 * Persisted enum signal — the stored string is validated against
 * `allowed` on read, falling back to the default when the saved value
 * is unknown (typical after enum churn between versions).
 */
export function persistedEnum<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): Signal<T> {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  const initial =
    stored !== null && (allowed as readonly string[]).includes(stored)
      ? (stored as T)
      : fallback;
  const [value, setValue] = createSignal<T>(initial);
  const wrapped: Signal<T>[1] = ((next: T | ((prev: T) => T)) => {
    const resolved =
      typeof next === "function" ? (next as (prev: T) => T)(value()) : next;
    localStorage.setItem(STORAGE_PREFIX + key, resolved);
    return setValue(() => resolved);
  }) as Signal<T>[1];
  return [value, wrapped];
}
