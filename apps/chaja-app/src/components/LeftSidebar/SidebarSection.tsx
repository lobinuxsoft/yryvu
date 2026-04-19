// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type JSX, Show } from "solid-js";

import { IconRefresh } from "../Icons";

export interface SidebarSectionProps {
  title: string;
  icon: JSX.Element;
  count?: number;
  initialExpanded?: boolean;
  addable?: boolean;
  onAdd?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: JSX.Element;
}

export function SidebarSection(props: SidebarSectionProps) {
  const [expanded, setExpanded] = createSignal(props.initialExpanded ?? false);
  return (
    <div class="sidebar__section" data-expanded={expanded() ? "true" : "false"}>
      <button
        class="sidebar__section-header"
        type="button"
        title={props.title}
        onClick={() => setExpanded((v) => !v)}
      >
        <span class="sidebar__section-caret">›</span>
        <span class="sidebar__section-icon">{props.icon}</span>
        <span class="sidebar__section-title">{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="sidebar__section-count">{props.count}</span>
        </Show>
        <Show when={props.onRefresh}>
          <span
            class="sidebar__section-refresh"
            data-spinning={props.refreshing ? "true" : "false"}
            role="button"
            tabindex={0}
            aria-label={`Refresh ${props.title}`}
            title={`Refresh ${props.title}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!props.refreshing) props.onRefresh?.();
            }}
          >
            <IconRefresh />
          </span>
        </Show>
        <Show when={props.addable}>
          <span
            class="sidebar__section-add"
            role="button"
            tabindex={0}
            aria-label={`Add to ${props.title}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onAdd?.();
            }}
          >
            +
          </span>
        </Show>
      </button>
      <div class="sidebar__section-body">{props.children}</div>
    </div>
  );
}
