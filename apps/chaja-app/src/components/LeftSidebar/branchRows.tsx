// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import type { BranchInfo } from "../../ipc";

export interface LocalBranchRowProps {
  branch: BranchInfo;
  onContextMenu: (e: MouseEvent, b: BranchInfo) => void;
  onCheckout: (name: string) => void;
}

export function LocalBranchRow(props: LocalBranchRowProps) {
  return (
    <div
      class="sidebar__branch-row"
      data-active={props.branch.is_head ? "true" : "false"}
      title={
        props.branch.upstream
          ? `tracks ${props.branch.upstream} — double-click to checkout`
          : "no upstream — double-click to checkout"
      }
      onContextMenu={(e) => props.onContextMenu(e, props.branch)}
      onDblClick={() => {
        if (!props.branch.is_head) props.onCheckout(props.branch.name);
      }}
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
  );
}

export interface RemoteBranchRowProps {
  branch: BranchInfo;
  onContextMenu: (e: MouseEvent, b: BranchInfo) => void;
}

export function RemoteBranchRow(props: RemoteBranchRowProps) {
  return (
    <div
      class="sidebar__branch-row"
      onContextMenu={(e) => props.onContextMenu(e, props.branch)}
    >
      <span class="sidebar__branch-name">{props.branch.name}</span>
    </div>
  );
}
