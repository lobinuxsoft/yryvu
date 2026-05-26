// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import {
  IconBranch,
  IconCheck,
  IconClose,
  IconCloud,
  IconMonitor,
  IconPin,
  IconTag,
} from "../../Icons";
import type { RefTag } from "../../../ipc/commits";
import {
  beginDrag,
  clearHoveredRef,
  dragPayload,
  dragTarget,
  endDrag,
  openDropPopover,
  resolveDropActions,
  setDropTarget,
  setHiddenRef,
  setHoveredRef,
} from "../../../state";
import { refKey, useBranchOps } from "../../../branchOps";
import { Tooltip } from "../../Tooltip";
import { hoveredKindFor } from "./ordering";

function pillKindClass(kind: RefTag["kind"]): string {
  switch (kind) {
    case "Head":
      return "ref-pill--head";
    case "Branch":
      return "ref-pill--branch";
    case "RemoteBranch":
      return "ref-pill--remote";
    case "Tag":
      return "ref-pill--tag";
  }
}

function PillKindIcon(props: { kind: RefTag["kind"] }) {
  switch (props.kind) {
    case "Head":
    case "Branch":
      return <IconBranch class="ref-pill__icon" width={12} height={12} />;
    case "RemoteBranch":
      return <IconCloud class="ref-pill__icon" width={12} height={12} />;
    case "Tag":
      return <IconTag class="ref-pill__icon" width={12} height={12} />;
  }
}

export interface RefPillProps {
  tag: RefTag;
  sha: string;
  active?: boolean;
  pinned?: boolean;
  ghost?: boolean;
  /** When true, suppress the hide-btn slot (matches GK's `!hasActive` gate). */
  suppressHide?: boolean;
}

export function RefPill(props: RefPillProps) {
  const ops = useBranchOps();
  const enter = () => {
    if (props.ghost) return;
    setHoveredRef({
      kind: hoveredKindFor(props.tag.kind),
      name: props.tag.name,
    });
  };
  const leave = () => {
    if (props.ghost) return;
    clearHoveredRef();
  };
  const hide = (e: MouseEvent) => {
    e.stopPropagation();
    setHiddenRef(refKey(props.tag), true);
  };

  // ---------------------------------------------------------------
  // Drag & drop wiring (issue #9). Ghost pills are non-interactive
  // overflow chips, so they opt out of every DnD event.
  // ---------------------------------------------------------------
  const onDragStart = (e: DragEvent) => {
    if (props.ghost) return;
    beginDrag({ kind: "ref", tag: props.tag, sha: props.sha });
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // The pill itself is the drag image — clean since it's already
      // a styled `<span>` with the right look.
      e.dataTransfer.setData("text/plain", props.tag.name);
    }
  };
  const onDragOver = (e: DragEvent) => {
    if (props.ghost) return;
    const src = dragPayload();
    if (!src) return;
    // Self-target → no drop.
    if (
      src.kind === "ref" &&
      src.tag.name === props.tag.name &&
      src.tag.kind === props.tag.kind
    )
      return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setDropTarget({ kind: "ref", tag: props.tag, sha: props.sha });
  };
  const onDragLeave = () => {
    if (props.ghost) return;
    const t = dragTarget();
    if (t && t.kind === "ref" && t.tag.name === props.tag.name) {
      setDropTarget(undefined);
    }
  };
  const onDrop = (e: DragEvent) => {
    if (props.ghost) return;
    const src = dragPayload();
    if (!src) return;
    e.preventDefault();
    const target = { kind: "ref" as const, tag: props.tag, sha: props.sha };
    const actions = resolveDropActions(src, target);
    if (actions.length > 0) {
      openDropPopover({
        x: e.clientX,
        y: e.clientY,
        source: src,
        target,
        actions,
      });
    }
    endDrag();
  };
  const onDragEnd = () => {
    if (props.ghost) return;
    endDrag();
  };

  /// Keyboard equivalent of the DnD gesture (issue #9 a11y acceptance):
  /// Space picks up the focused pill as the drag source; the user
  /// moves focus with Tab to another pill; Enter on that pill opens
  /// the drop popover anchored at the focused element. Esc cancels.
  const onKeyDown = (e: KeyboardEvent) => {
    if (props.ghost) return;
    if (e.key === " " && !dragPayload()) {
      e.preventDefault();
      beginDrag({ kind: "ref", tag: props.tag, sha: props.sha });
      return;
    }
    if (e.key === "Escape") {
      if (dragPayload()) {
        e.preventDefault();
        endDrag();
      }
      return;
    }
    if (e.key === "Enter" && dragPayload()) {
      const src = dragPayload()!;
      if (
        src.kind === "ref" &&
        src.tag.name === props.tag.name &&
        src.tag.kind === props.tag.kind
      ) {
        return;
      }
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const target = { kind: "ref" as const, tag: props.tag, sha: props.sha };
      const actions = resolveDropActions(src, target);
      if (actions.length > 0) {
        openDropPopover({
          x: rect.right,
          y: rect.bottom,
          source: src,
          target,
          actions,
        });
      }
      endDrag();
    }
  };
  // Compact mode does NOT change pill anatomy — verified against GK's
  // bundle (`mode: Compact` is telemetry metadata, not a rendering
  // switch). Pills always render full text + icons; the only effect
  // of compact mode is column widths + reorder + dateTime hidden.
  const showMonitor = () => props.active === true;
  const showCloud = () =>
    props.tag.kind === "Branch" && props.tag.upstream !== null;
  return (
    <Tooltip text={props.tag.name}>
    <span
      class="ref-pill"
      classList={{
        [pillKindClass(props.tag.kind)]: true,
        "is-active": props.active,
        "is-pinned": props.pinned && !props.active,
        "is-ghost": props.ghost,
        "is-drop-target":
          !props.ghost &&
          (() => {
            const t = dragTarget();
            return (
              t?.kind === "ref" &&
              t.tag.name === props.tag.name &&
              t.tag.kind === props.tag.kind
            );
          })(),
      }}
      tabIndex={props.ghost ? -1 : 0}
      draggable={!props.ghost}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      onContextMenu={(e) => {
        if (props.ghost) return;
        ops.openRefContextMenu(e, props.tag, props.sha);
      }}
    >
      <Show when={props.active}>
        <IconCheck class="ref-pill__annotation" width={12} height={12} />
      </Show>
      <Show when={props.pinned && !props.active}>
        <IconPin class="ref-pill__annotation" width={12} height={12} />
      </Show>
      <PillKindIcon kind={props.tag.kind} />
      <span class="ref-pill__name">{props.tag.name}</span>
      <Show when={showMonitor()}>
        <IconMonitor class="ref-pill__icon-r" width={11} height={11} />
      </Show>
      <Show when={showCloud()}>
        <IconCloud class="ref-pill__icon-r" width={11} height={11} />
      </Show>
      <Show
        when={
          props.tag.upstream && (props.tag.ahead > 0 || props.tag.behind > 0)
        }
      >
        <Tooltip
          text={`Tracks ${props.tag.upstream} (${props.tag.ahead} ahead, ${props.tag.behind} behind)`}
        >
          <span class="ref-pill__upstream">
            <Show when={props.tag.ahead > 0}>
              <span class="ref-pill__ahead">↑{props.tag.ahead}</span>
            </Show>
            <Show when={props.tag.behind > 0}>
              <span class="ref-pill__behind">↓{props.tag.behind}</span>
            </Show>
          </span>
        </Tooltip>
      </Show>
      <Show
        when={!props.ghost && !props.suppressHide && props.tag.kind !== "Head"}
      >
        <Tooltip text={`Hide '${props.tag.name}'`}>
          <button
            type="button"
            class="ref-pill__hide-btn"
            aria-label={`Hide ${props.tag.name}`}
            onClick={hide}
          >
            <IconClose width={10} height={10} />
          </button>
        </Tooltip>
      </Show>
    </span>
    </Tooltip>
  );
}
