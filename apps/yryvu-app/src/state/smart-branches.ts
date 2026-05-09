// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import { persistedBool } from "./storage";

/// Smart Branch Visibility — global toggle that drives a 1:1 port of
/// GitKraken's `SmartBranchesService.resolveAllowedRefs`. When enabled,
/// `CommitGraph` invokes the backend `smart_visible_refs` IPC and stores
/// the complement (every ref *not* in the allowed set) in
/// `hiddenBySmartFilter` so `RefPillGroup` can filter without recomputing.
/// Persistence is profile-wide via `localStorage` (chajá has no
/// per-profile config yet; matches GK's `["ui","graphOptions",
/// "smartBranches"]` semantics functionally).
export const [smartBranchesEnabled, setSmartBranchesEnabled] = persistedBool(
  "smartBranchesEnabled",
  false,
);

/// Set of `${kind}/${name}` keys hidden by the Smart Branch Visibility
/// filter. Computed by `CommitGraph` whenever the IPC resolves a new
/// allowlist. Empty when the toggle is off so RefPillGroup short-circuits.
/// The set is *additive* with `hiddenRefs` (manual user hides) — chajá
/// keeps the two filters separate, unlike GK which writes both to the
/// repo-level `soloedRefs` setting.
const [hiddenBySmartFilterInternal, setHiddenBySmartFilterInternal] =
  createSignal<Set<string>>(new Set());
export const hiddenBySmartFilter = hiddenBySmartFilterInternal;

export function setHiddenBySmartFilter(next: Set<string>): void {
  setHiddenBySmartFilterInternal(next);
}
