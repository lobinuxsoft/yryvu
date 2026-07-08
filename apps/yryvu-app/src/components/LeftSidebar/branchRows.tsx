// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import type { BranchInfo } from "../../ipc";
import {
  clearHoveredRef,
  navigateToRef,
  setHoveredRef,
} from "../../state";
import { Tooltip } from "../Tooltip";

export interface LocalBranchRowProps {
  branch: BranchInfo;
  onContextMenu: (e: MouseEvent, b: BranchInfo) => void;
  onCheckout: (name: string) => void;
}

export function LocalBranchRow(props: LocalBranchRowProps) {
  return (
    <Tooltip
      text={
        props.branch.upstream
          ? `tracks ${props.branch.upstream} — double-click to checkout`
          : "no upstream — double-click to checkout"
      }
    >
    <div
      class="sidebar__branch-row"
      data-active={props.branch.is_head ? "true" : "false"}
      onClick={() => navigateToRef(props.branch.tip_sha)}
      onContextMenu={(e) => props.onContextMenu(e, props.branch)}
      onDblClick={() => {
        if (!props.branch.is_head) props.onCheckout(props.branch.name);
      }}
      onMouseEnter={() =>
        setHoveredRef({ kind: "head", name: props.branch.name })
      }
      onMouseLeave={clearHoveredRef}
    >
      <span class="sidebar__branch-name">{props.branch.name}</span>
      <Show when={props.branch.ahead > 0 || props.branch.behind > 0}>
        <span class="sidebar__branch-tracking">
          <Show when={props.branch.ahead > 0}>
            <span data-dir="ahead">{props.branch.ahead}↑</span>
          </Show>
          <Show when={props.branch.behind > 0}>
            <span data-dir="behind">{props.branch.behind}↓</span>
          </Show>
        </span>
      </Show>
    </div>
    </Tooltip>
  );
}

export interface RemoteBranchRowProps {
  branch: BranchInfo;
  onContextMenu: (e: MouseEvent, b: BranchInfo) => void;
  /// Label override for nested rendering under a remote folder row
  /// (#239): shows `main` instead of `origin/main`. `branch` keeps the
  /// full name — menu handlers and hover state stay remote-qualified.
  displayName?: string;
  /// Indents the row one level under its folder (#239).
  nested?: boolean;
}

export function RemoteBranchRow(props: RemoteBranchRowProps) {
  return (
    <div
      class="sidebar__branch-row"
      classList={{ "sidebar__branch-row--nested": props.nested }}
      onClick={() => navigateToRef(props.branch.tip_sha)}
      onContextMenu={(e) => props.onContextMenu(e, props.branch)}
      onMouseEnter={() =>
        setHoveredRef({ kind: "remote", name: props.branch.name })
      }
      onMouseLeave={clearHoveredRef}
    >
      <span class="sidebar__branch-name">
        {props.displayName ?? props.branch.name}
      </span>
    </div>
  );
}
