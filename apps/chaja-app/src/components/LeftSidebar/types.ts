// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MergeResult } from "../../ipc";
import type { ContextMenuItem } from "../ContextMenu";

export type MenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
};

export type DialogState =
  | { kind: "create"; from?: string }
  | { kind: "rename"; oldName: string }
  | { kind: "delete"; name: string; unmerged?: boolean }
  | { kind: "checkout-dirty"; target: string }
  | { kind: "merge-pick"; source: string }
  | { kind: "merge-result"; result: MergeResult }
  | { kind: "delete-remote"; remote: string; name: string }
  | { kind: "submodule-add" }
  | { kind: "submodule-remove"; name: string; path: string }
  | { kind: "set-upstream"; branchName: string; currentUpstream: string | null }
  | null;
