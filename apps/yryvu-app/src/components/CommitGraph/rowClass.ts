// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Module-level className cache (Bd pattern from doc 12 — row wrapper).
 * Keyed by `type` only — `isHovering` / `isSelected` (and the
 * filter/hover `is-dimmed` from #54 + #111) live in `classList` on the
 * caller so they compose with each other without Solid's reactive
 * `class` rebind clearing them on every hover tick.
 *
 * Why the split: when a row reactively re-runs the `class` expression
 * (because `is-hovering` toggled), Solid clears the cached classList
 * entries momentarily before re-applying them. That brief gap visibly
 * un-dims rows while the mouse moves across them — keeping every
 * dynamic state in `classList` makes the transition stable.
 */
const cache = new Map<string, string>();

export function rowWrapperClass(type: "commit" | "merge" | "wip"): string {
  let cls = cache.get(type);
  if (cls) return cls;
  cls = `graph-row-wrapper graph-row-wrapper--${type}`;
  cache.set(type, cls);
  return cls;
}
