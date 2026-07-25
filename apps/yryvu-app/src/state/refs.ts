// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import { STORAGE_PREFIX } from "./storage";

/// Refs the user has hidden from the graph via the ref-pill context menu.
/// Keyed by `<kind>/<name>` so tags and branches with colliding names stay
/// distinct (matches the GK bundle's per-(kind,name) tracking). Persisted
/// globally — GK persists per-repo but until profile-level prefs land the
/// extra bookkeeping is overkill, and the cost of carrying a stale entry
/// across repo switches is just an empty filter pass.
const HIDDEN_REFS_KEY = `${STORAGE_PREFIX}hiddenRefs`;

function loadHiddenRefs(): Set<string> {
  const raw = localStorage.getItem(HIDDEN_REFS_KEY);
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set<string>(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set<string>();
  }
}

const [hiddenRefsInternal, setHiddenRefsInternal] =
  createSignal<Set<string>>(loadHiddenRefs());

export const hiddenRefs = hiddenRefsInternal;

function persistHiddenRefs(next: Set<string>): void {
  localStorage.setItem(HIDDEN_REFS_KEY, JSON.stringify(Array.from(next)));
}

export function setHiddenRef(key: string, hidden: boolean): void {
  const next = new Set(hiddenRefsInternal());
  if (hidden) next.add(key);
  else next.delete(key);
  persistHiddenRefs(next);
  setHiddenRefsInternal(next);
}
