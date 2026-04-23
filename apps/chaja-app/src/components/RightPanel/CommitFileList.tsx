// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { WorkingTreeChange } from "../../ipc";
import { statusTone } from "./statusTone";

/// Generic row action surfaced on hover. Unstaged rows expose Stage +
/// Discard; staged rows expose Unstage.
export interface RowAction {
  label: string;
  title?: string;
  /// Applies `data-variant="danger"` to tint destructive actions red on
  /// hover — Discard is the only current user.
  variant?: "default" | "danger";
  onClick: (path: string) => void;
}

export interface CommitFileListProps {
  title: string;
  side: "unstaged" | "staged";
  changes: WorkingTreeChange[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /// Primary batch action on the section header (Stage All / Unstage All).
  bulkActionLabel: string;
  onBulkAction: () => void;
  rowActions: RowAction[];
  onRowClick: (path: string) => void;
  isActive: (path: string) => boolean;
}

export function CommitFileList(props: CommitFileListProps) {
  const count = () => props.changes.length;

  return (
    <section class="commit-panel__section" data-side={props.side}>
      <header class="commit-panel__section-header">
        <button
          class="commit-panel__section-toggle"
          type="button"
          aria-expanded={!props.collapsed}
          onClick={() => props.onToggleCollapsed()}
          title={props.collapsed ? "Expand" : "Collapse"}
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
        <Show when={count() > 0}>
          <button
            class="commit-panel__bulk"
            type="button"
            title={props.bulkActionLabel}
            onClick={() => props.onBulkAction()}
          >
            {props.bulkActionLabel}
          </button>
        </Show>
      </header>
      <Show when={!props.collapsed}>
        <ul class="commit-panel__list">
          <For each={props.changes}>
            {(c) => (
              <FileRow
                change={c}
                side={props.side}
                active={props.isActive(c.path)}
                onClick={() => props.onRowClick(c.path)}
                actions={props.rowActions}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

interface FileRowProps {
  change: WorkingTreeChange;
  side: "unstaged" | "staged";
  active: boolean;
  onClick: () => void;
  actions: RowAction[];
}

function FileRow(props: FileRowProps) {
  const tone = () => statusTone(props.change.status);
  return (
    <li>
      <div
        class="commit-panel__row"
        data-active={props.active ? "true" : "false"}
        data-side={props.side}
      >
        <button
          class="commit-panel__row-main"
          type="button"
          title={props.change.path}
          onClick={() => props.onClick()}
        >
          <span class="changed-files__status" data-tone={tone().tone}>
            {tone().label}
          </span>
          <Show when={props.change.old_path}>
            <span class="changed-files__old">{props.change.old_path} →</span>
          </Show>
          <span class="changed-files__path">{props.change.path}</span>
        </button>
        <div class="commit-panel__row-actions">
          <For each={props.actions}>
            {(a) => (
              <button
                class="commit-panel__row-action"
                type="button"
                data-variant={a.variant ?? "default"}
                title={a.title ?? a.label}
                onClick={(e) => {
                  e.stopPropagation();
                  a.onClick(props.change.path);
                }}
              >
                {a.label}
              </button>
            )}
          </For>
        </div>
      </div>
    </li>
  );
}
