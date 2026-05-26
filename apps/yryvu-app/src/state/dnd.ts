// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drag controller for the graph's signature gesture (issue #9 — drag
 * a ref onto another ref or onto a commit to merge / rebase /
 * cherry-pick / reset).
 *
 * Logic-only: this module models the drag payload, target, and the
 * pure `resolveDropActions(source, target) -> DropAction[]` table.
 * The DOM event wiring lives in `components/CommitGraph/dnd/*` so
 * keyboard fallbacks (issue #9 a11y acceptance) can drive the same
 * pipeline without touching `dragstart` / `drop` browser events.
 *
 * Audit: `docs/research/gitkraken-graph/17-drag-drop-refs.md`.
 */

import { createSignal } from "solid-js";

import type { RefTag } from "../ipc";

/// Discriminated payload — the "what is being dragged". Refs carry
/// their tag for action eligibility; commits carry their sha.
export type DragPayload =
  | { kind: "ref"; tag: RefTag; sha: string }
  | { kind: "commit"; sha: string };

/// Target the user is hovering during the drag. `null` = none.
export type DragTarget =
  | { kind: "ref"; tag: RefTag; sha: string }
  | { kind: "commit"; sha: string };

/// Action surfaced in the drop popover. The id flows through to the
/// IPC dispatcher in `dnd/applyAction.ts`. Disabled actions still
/// render but can't be activated — keeps the popover anchored to a
/// stable item set so keyboard focus order is predictable.
export type DropActionId =
  | "merge"
  | "rebase-current-onto"
  | "fast-forward"
  | "cherry-pick"
  | "reset-soft"
  | "reset-mixed"
  | "reset-hard"
  | "checkout";

export interface DropAction {
  id: DropActionId;
  label: string;
  /// `true` when GK's gate would prevent the action (e.g. fast-forward
  /// across diverged history). Kept visible but unselectable.
  disabled?: boolean;
  /// Marks the destructive variants for the danger-tinted button in
  /// the menu (reset-hard, mainly).
  danger?: boolean;
}

const [dragPayload, setDragPayload] = createSignal<DragPayload | undefined>(undefined);
const [dragTarget, setDragTarget] = createSignal<DragTarget | undefined>(undefined);
export { dragPayload, dragTarget };

export function beginDrag(payload: DragPayload): void {
  setDragPayload(payload);
}

export function setDropTarget(target: DragTarget | undefined): void {
  setDragTarget(target);
}

export function endDrag(): void {
  setDragPayload(undefined);
  setDragTarget(undefined);
}

/// Action resolver. Pure — same inputs produce same outputs. Tests
/// cover the eligibility matrix; the runtime wires it to the drop
/// event in `RefPill` + `GraphZone` row drop handlers.
export function resolveDropActions(
  source: DragPayload,
  target: DragTarget,
): DropAction[] {
  if (source.kind === "ref" && target.kind === "ref") {
    return refOntoRefActions(source.tag, target.tag);
  }
  if (source.kind === "ref" && target.kind === "commit") {
    return refOntoCommitActions(source.tag, target.sha);
  }
  if (source.kind === "commit" && target.kind === "ref") {
    // Symmetric with ref-onto-commit but inverted intent: dragging a
    // commit onto a branch typically expresses "cherry-pick onto this
    // branch's tip" which is more naturally done by checking out and
    // then cherry-picking. We surface only the simpler cherry-pick to
    // the active branch path here.
    return [{ id: "cherry-pick", label: `Cherry-pick ${source.sha.slice(0, 7)} onto current` }];
  }
  if (source.kind === "commit" && target.kind === "commit") {
    return commitOntoCommitActions(source.sha);
  }
  return [];
}

function refOntoRefActions(source: RefTag, target: RefTag): DropAction[] {
  // Dragging onto self is a no-op.
  if (source.name === target.name && source.kind === target.kind) return [];
  // `Head` is a synthetic ref pinned to the active commit — treat it
  // as the active branch for direction resolution.
  const targetIsHead = target.kind === "Head";
  const sourceLabel = source.name;
  const targetLabel = target.name;

  const actions: DropAction[] = [];
  if (targetIsHead) {
    // Source onto current → integrate source's commits into current.
    actions.push({
      id: "merge",
      label: `Merge '${sourceLabel}' into current`,
    });
    actions.push({
      id: "rebase-current-onto",
      label: `Rebase current onto '${sourceLabel}'`,
    });
    // Fast-forward eligibility is decided backend-side; surface
    // it always and let the action gate enforce.
    actions.push({
      id: "fast-forward",
      label: `Fast-forward to '${sourceLabel}'`,
    });
  } else {
    // Source onto another (non-head) ref: ambiguous direction. The
    // most common Fork/GK interpretation is "merge source into
    // target after a transient checkout", but we keep it explicit:
    // surface a single merge action labelled with both names.
    actions.push({
      id: "merge",
      label: `Merge '${sourceLabel}' into '${targetLabel}'`,
    });
    actions.push({
      id: "rebase-current-onto",
      label: `Rebase '${targetLabel}' onto '${sourceLabel}'`,
    });
  }
  return actions;
}

function refOntoCommitActions(source: RefTag, targetSha: string): DropAction[] {
  // Dragging a ref onto a commit row maps to the rebase-onto-sha
  // family + the cherry-pick of that commit onto source. Most
  // common GK use-case: "rebase this branch onto this commit".
  return [
    {
      id: "rebase-current-onto",
      label: `Rebase current onto ${targetSha.slice(0, 7)}`,
    },
    {
      id: "checkout",
      label: `Checkout '${source.name}' and reset to ${targetSha.slice(0, 7)}`,
    },
  ];
}

function commitOntoCommitActions(sourceSha: string): DropAction[] {
  return [
    {
      id: "cherry-pick",
      label: `Cherry-pick ${sourceSha.slice(0, 7)} onto current`,
    },
    {
      id: "reset-soft",
      label: `Reset current to ${sourceSha.slice(0, 7)} (soft)`,
    },
    {
      id: "reset-mixed",
      label: `Reset current to ${sourceSha.slice(0, 7)} (mixed)`,
    },
    {
      id: "reset-hard",
      label: `Reset current to ${sourceSha.slice(0, 7)} (hard) — DESTRUCTIVE`,
      danger: true,
    },
  ];
}

/// Drop popover position + payload. Set on drop; read by
/// `DropActionMenu` to render and act.
export interface DropPopover {
  x: number;
  y: number;
  source: DragPayload;
  target: DragTarget;
  actions: DropAction[];
}

const [dropPopover, setDropPopover] = createSignal<DropPopover | undefined>(undefined);
export { dropPopover };

export function openDropPopover(p: DropPopover): void {
  setDropPopover(p);
}

export function closeDropPopover(): void {
  setDropPopover(undefined);
}
