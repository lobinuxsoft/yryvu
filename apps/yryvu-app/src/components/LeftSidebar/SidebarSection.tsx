// SPDX-License-Identifier: AGPL-3.0-or-later

import { type JSX, Show } from "solid-js";

import {
  expandedSections,
  toggleSectionExpanded,
  type SectionKey,
} from "../../state";

import { Tooltip } from "../Tooltip";
import { Icon } from "../Icon";

export interface SidebarSectionProps {
  /// Stable identity for this section. Drives shared expand state +
  /// context-menu wiring. Each section's key matches GK's HEADER_KEYS
  /// (audit doc 00) so the persistence shape is portable.
  sectionKey: SectionKey;
  title: string;
  icon: JSX.Element;
  count?: number;
  addable?: boolean;
  /// Receives the click event so menu-style add buttons (GITFLOW) can
  /// anchor a context menu at the cursor. Dialog-style adders (LOCAL)
  /// just ignore it.
  onAdd?: (e: MouseEvent) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  /// Right-click on the header → builder for the section context menu
  /// (#220 / audit doc 10). Optional so consumers that don't pass one
  /// just drop the right-click affordance silently.
  onContextMenu?: (e: MouseEvent, key: SectionKey) => void;
  children: JSX.Element;
}

export function SidebarSection(props: SidebarSectionProps) {
  const expanded = () => expandedSections().has(props.sectionKey);
  return (
    <div class="sidebar__section" data-expanded={expanded() ? "true" : "false"}>
      <Tooltip text={props.title}>
      <button
        class="sidebar__section-header"
        type="button"
        onClick={() => toggleSectionExpanded(props.sectionKey)}
        onContextMenu={(e) => {
          if (!props.onContextMenu) return;
          props.onContextMenu(e, props.sectionKey);
        }}
      >
        <span class="sidebar__section-caret">›</span>
        <span class="sidebar__section-icon">{props.icon}</span>
        <span class="sidebar__section-title">{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="sidebar__section-count">{props.count}</span>
        </Show>
        <Show when={props.onRefresh}>
          <Tooltip text={`Refresh ${props.title}`}>
            <span
              class="sidebar__section-refresh"
              data-spinning={props.refreshing ? "true" : "false"}
              role="button"
              tabindex={0}
              aria-label={`Refresh ${props.title}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!props.refreshing) props.onRefresh?.();
              }}
            >
              <Icon name="refresh" />
            </span>
          </Tooltip>
        </Show>
        <Show when={props.addable}>
          <span
            class="sidebar__section-add"
            role="button"
            tabindex={0}
            aria-label={`Add to ${props.title}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onAdd?.(e);
            }}
          >
            +
          </span>
        </Show>
      </button>
      </Tooltip>
      <div class="sidebar__section-body">{props.children}</div>
    </div>
  );
}
