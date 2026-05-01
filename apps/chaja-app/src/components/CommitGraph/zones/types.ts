// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Accessor } from "solid-js";
import type { Virtualizer } from "@tanstack/solid-virtual";

import type { GraphRow, HostingService } from "../../../ipc";
import type { RowEdges } from "../edgeStates";
import type { GraphLayout } from "../useGraphLayout";
import type { GraphSelection } from "../useGraphSelection";

/**
 * Wide deps bag every zone consumes. Each zone picks the slice it
 * needs; collecting them here keeps the orchestrator's render call
 * site readable.
 */
export interface ZoneDeps {
  rows: Accessor<GraphRow[]>;
  hostingService: Accessor<HostingService>;
  edgeStates: Accessor<RowEdges[]>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  layout: GraphLayout;
  selection: GraphSelection;
  hoveredCommit: Accessor<string | undefined>;
  setHoveredCommit: (sha: string | undefined) => void;
  /**
   * Optional context-menu handler — only the message zone wires this
   * (right-click on a commit row's summary).
   */
  openCommitContextMenu?: (e: MouseEvent, sha: string, shortSha: string) => void;
}
