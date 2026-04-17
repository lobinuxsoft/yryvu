// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type JSX, Show } from "solid-js";

import { repoPath, setShowLeftPanel, showLeftPanel } from "../../state";

interface SidebarSectionProps {
  title: string;
  count?: number;
  initialExpanded?: boolean;
  addable?: boolean;
  children: JSX.Element;
}

function SidebarSection(props: SidebarSectionProps) {
  const [expanded, setExpanded] = createSignal(props.initialExpanded ?? false);
  return (
    <div class="sidebar__section" data-expanded={expanded() ? "true" : "false"}>
      <button
        class="sidebar__section-header"
        type="button"
        onClick={() => setExpanded((v) => !v)}
      >
        <span class="sidebar__section-caret">›</span>
        <span>{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="sidebar__section-count">{props.count}</span>
        </Show>
        <Show when={props.addable}>
          <span
            class="sidebar__section-add"
            role="button"
            tabindex={0}
            aria-label={`Add to ${props.title}`}
            onClick={(e) => {
              e.stopPropagation();
              // TODO: wire per-section add handlers
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

export function LeftSidebar() {
  // Collapsed icon-rail mode is orthogonal to hidden; handled here via local state
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <aside class="sidebar" data-collapsed={collapsed() ? "true" : "false"}>
      <div class="sidebar__header">
        <button
          class="tabs__leading-btn"
          type="button"
          title={collapsed() ? "Expand sidebar" : "Collapse to icons"}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed() ? "›" : "‹"}
        </button>
        <span>Viewing</span>
        <span class="sidebar__item-badge">0</span>
      </div>

      <Show when={!collapsed()}>
        <div class="sidebar__filter">
          <input type="text" placeholder="Filter (Ctrl+Alt+F)" />
        </div>
      </Show>

      <div class="sidebar__sections">
        <SidebarSection title="Local" count={0} initialExpanded>
          <p class="sidebar__item-badge" style={{ padding: "8px 10px 8px 24px" }}>
            <Show when={repoPath()} fallback={<em>Open a repo to list branches</em>}>
              <em>Branch listing not implemented in #29</em>
            </Show>
          </p>
        </SidebarSection>
        <SidebarSection title="Remote" count={0}>
          <p class="sidebar__item-badge" style={{ padding: "8px 10px 8px 24px" }}>—</p>
        </SidebarSection>
        <SidebarSection title="Cloud Patches" count={0}>
          <p class="sidebar__item-badge" style={{ padding: "8px 10px 8px 24px" }}>—</p>
        </SidebarSection>
        <SidebarSection title="Pull Requests" count={0} addable>
          <p class="sidebar__item-badge" style={{ padding: "8px 10px 8px 24px" }}>—</p>
        </SidebarSection>
        <SidebarSection title="GitHub Issues" count={0}>
          <p class="sidebar__item-badge" style={{ padding: "8px 10px 8px 24px" }}>—</p>
        </SidebarSection>
        <SidebarSection title="Tags" count={0}>
          <p class="sidebar__item-badge" style={{ padding: "8px 10px 8px 24px" }}>—</p>
        </SidebarSection>
        <SidebarSection title="Teams" count={0}>
          <p class="sidebar__item-badge" style={{ padding: "8px 10px 8px 24px" }}>—</p>
        </SidebarSection>
      </div>
    </aside>
  );
}

/** Re-export a control so the shell can hide/show the whole sidebar via Ctrl+J handler. */
export const sidebarVisibility = { showLeftPanel, setShowLeftPanel } as const;
