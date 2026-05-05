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
  clearHoveredRef,
  setHiddenRef,
  setHoveredRef,
} from "../../../state";
import { refKey, useBranchOps } from "../../../branchOps";
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
  // Compact mode does NOT change pill anatomy — verified against GK's
  // bundle (`mode: Compact` is telemetry metadata, not a rendering
  // switch). Pills always render full text + icons; the only effect
  // of compact mode is column widths + reorder + dateTime hidden.
  const showMonitor = () => props.active === true;
  const showCloud = () =>
    props.tag.kind === "Branch" && props.tag.upstream !== null;
  return (
    <span
      class="ref-pill"
      classList={{
        [pillKindClass(props.tag.kind)]: true,
        "is-active": props.active,
        "is-pinned": props.pinned && !props.active,
        "is-ghost": props.ghost,
      }}
      title={props.tag.name}
      tabIndex={props.ghost ? -1 : 0}
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
        <span
          class="ref-pill__upstream"
          title={`Tracks ${props.tag.upstream} (${props.tag.ahead} ahead, ${props.tag.behind} behind)`}
        >
          <Show when={props.tag.ahead > 0}>
            <span class="ref-pill__ahead">↑{props.tag.ahead}</span>
          </Show>
          <Show when={props.tag.behind > 0}>
            <span class="ref-pill__behind">↓{props.tag.behind}</span>
          </Show>
        </span>
      </Show>
      <Show
        when={!props.ghost && !props.suppressHide && props.tag.kind !== "Head"}
      >
        <button
          type="button"
          class="ref-pill__hide-btn"
          title={`Hide '${props.tag.name}'`}
          aria-label={`Hide ${props.tag.name}`}
          onClick={hide}
        >
          <IconClose width={10} height={10} />
        </button>
      </Show>
    </span>
  );
}
