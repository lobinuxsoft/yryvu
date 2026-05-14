// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

/// Inspector mode — "details" shows the selected commit; "staging" shows the
/// Unstaged/Staged file lists. Toggled by the WIP banner's View Changes button.
export type InspectorMode = "details" | "staging";
export const [inspectorMode, setInspectorMode] =
  createSignal<InspectorMode>("details");

/// The ref the cursor is hovering (either a pill in the graph's BRANCH/TAG
/// column or a row in the sidebar). Drives the graph's hover-dim effect
/// (#54) — commits that aren't ancestors of the hovered ref fade to a low
/// opacity, so the user can see at a glance which commits "belong to"
/// that branch/tag.
///
/// Matches GitKraken's `isMissingHoveredRefGroup` selector (doc 08 / bundle
/// `Gd` row wrapper): the membership test uses the row's own refs first,
/// then falls back to the pre-computed `child_refs` propagated bottom-up
/// by `graph-core::populate_child_refs`.
export type HoveredRefKind = "head" | "remote" | "tag";
export interface HoveredRef {
  kind: HoveredRefKind;
  name: string;
}
export const [hoveredRef, setHoveredRef] = createSignal<HoveredRef | undefined>(
  undefined,
);
export function clearHoveredRef() {
  setHoveredRef(undefined);
}

/// SHA of the trunk pin chosen by the backend's `pick_pinned_head`. Written
/// once per repo by the graph stream's `onPinned` callback; consumed by the
/// ref-pill ordering pass to surface the pinned-branch annotation (doc 06
/// stage 2). `undefined` until the first stream batch arrives, or for repos
/// with no resolvable trunk (detached HEAD + no remote default).
export const [pinnedSha, setPinnedSha] = createSignal<string | undefined>(
  undefined,
);
