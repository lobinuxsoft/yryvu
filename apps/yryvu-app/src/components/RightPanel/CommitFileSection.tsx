// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import type { FileDiff } from "../../ipc/diff";
import { FileList, type RowAction } from "../FileList";
import { Tooltip } from "../Tooltip";

/**
 * One collapsible file section of the commit panel. The Unstaged and
 * Staged blocks are structurally identical — same header / chevron /
 * bulk action / FileList — differing only by side, copy, and handlers.
 * `revKey` and `listType` both equal `side` (the rev keys are literally
 * `"unstaged"` / `"staged"`), so a single `side` prop drives all three.
 */
export interface CommitFileSectionProps {
  side: "unstaged" | "staged";
  title: string;
  /** Bulk-action label, used for both the tooltip and the button. */
  bulkLabel: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onBulk: () => void;
  /** Optional destructive secondary bulk action (e.g. "Discard All"). */
  secondaryBulkLabel?: string;
  onSecondaryBulk?: () => void;
  repoId: string;
  files: FileDiff[];
  activeFilePath: string | undefined;
  onSelectFile: (path: string) => void;
  rowActions: RowAction[];
}

export function CommitFileSection(props: CommitFileSectionProps) {
  const count = () => props.files.length;

  return (
    <section
      class="commit-panel__section"
      data-side={props.side}
      // GK parity (#430): an expanded section with files claims its 50%
      // flex share; collapsed or empty it drops to header height and the
      // sibling absorbs the space (GK's .stage/.unstage class toggle).
      data-expanded={!props.collapsed && count() > 0 ? "true" : "false"}
    >
      <header class="commit-panel__section-header">
        <Tooltip text={props.collapsed ? "Expand" : "Collapse"}>
          <button
            class="commit-panel__section-toggle"
            type="button"
            aria-expanded={!props.collapsed}
            onClick={props.onToggleCollapsed}
          >
            <span
              class="commit-panel__section-chevron"
              data-collapsed={props.collapsed ? "true" : "false"}
            >
              ▸
            </span>
            <span class="commit-panel__section-title">{props.title}</span>
            <span class="commit-panel__section-count">{count()}</span>
          </button>
        </Tooltip>
        <Show when={count() > 0}>
          <Tooltip text={props.bulkLabel}>
            <button
              class="commit-panel__bulk"
              type="button"
              onClick={props.onBulk}
            >
              {props.bulkLabel}
            </button>
          </Tooltip>
          <Show when={props.secondaryBulkLabel && props.onSecondaryBulk}>
            <Tooltip text={props.secondaryBulkLabel!}>
              <button
                class="commit-panel__bulk commit-panel__bulk--danger"
                type="button"
                onClick={props.onSecondaryBulk}
              >
                {props.secondaryBulkLabel}
              </button>
            </Tooltip>
          </Show>
        </Show>
      </header>
      <Show when={!props.collapsed && count() > 0}>
        <FileList
          repoId={props.repoId}
          revKey={props.side}
          listType={props.side}
          files={props.files}
          activeFilePath={props.activeFilePath}
          onSelectFile={props.onSelectFile}
          rowActions={props.rowActions}
          hideToolbar
        />
      </Show>
    </section>
  );
}
