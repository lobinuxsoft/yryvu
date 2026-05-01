// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Module-level className cache (Bd pattern from doc 12 — row wrapper).
 * Keyed by `type + isHovering + isSelected` concatenation. Solid's reactivity
 * is granular enough to avoid needing this strictly, but adopting matches
 * GitKraken's render hot-path optimization for 1:1 parity.
 */
const cache = new Map<string, string>();

export function rowWrapperClass(
  type: "commit" | "merge" | "wip",
  isHovering: boolean,
  isSelected: boolean,
): string {
  const key = `${type}|${isHovering ? 1 : 0}|${isSelected ? 1 : 0}`;
  let cls = cache.get(key);
  if (cls) return cls;
  const parts = ["graph-row-wrapper", `graph-row-wrapper--${type}`];
  if (isHovering) parts.push("is-hovering");
  if (isSelected) parts.push("is-selected");
  cls = parts.join(" ");
  cache.set(key, cls);
  return cls;
}
