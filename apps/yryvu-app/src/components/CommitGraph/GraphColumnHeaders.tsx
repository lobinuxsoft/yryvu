// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Header strip above the commit graph: column labels, resize handles
 * between them, and the column-settings ⚙ button (1:1 with GK's column
 * header chrome). Iterates `activeOrderedZones()` so the bundle's
 * compact-mode reordering (author left of message) falls out
 * automatically. Each header column reads its width from the active
 * slice of the column state. Right-click on any header opens the
 * same settings popover as the gear button (mirrors GK's column header
 * context menu).
 */

import { createMemo, For, onCleanup, onMount, Show } from "solid-js";

import {
  activeColumnSettings,
  activeOrderedZones,
  ensureColumnWidthsFitContainer,
} from "../../state";
import {
  ColumnSettingsMenu,
  createMenuState,
} from "./ColumnSettingsButton";
import { GraphColumnResizer } from "./GraphColumnResizer";
import { HiddenRefsButton } from "./HiddenRefsButton";
import { ZONE_SPECS, type GraphZoneId } from "./columns";

function HeaderLabel(props: { id: GraphZoneId }) {
  if (props.id === "ref") {
    return (
      <span class="main__graph-column-header-branch">
        <span>{ZONE_SPECS.ref.label}</span>
        <HiddenRefsButton />
      </span>
    );
  }
  return <span class="main__graph-column-label">{ZONE_SPECS[props.id].label}</span>;
}

export function GraphColumnHeaders() {
  const visible = createMemo(() => activeOrderedZones());
  const menu = createMenuState();
  let containerEl: HTMLDivElement | undefined;
  let observer: ResizeObserver | undefined;

  // Watch the live container width — the column cascade math assumes
  // `sum(widths) === containerWidth`, so any change to the parent (window
  // resize, panel toggles, font-zoom) needs to re-balance the visible
  // zones. Mirrors GK's `onGraphResized → ensureZoneWidthsMatchGraphWidth`.
  onMount(() => {
    if (!containerEl || typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) ensureColumnWidthsFitContainer(w);
      }
    });
    observer.observe(containerEl);
  });

  onCleanup(() => observer?.disconnect());

  // Open the menu near the cursor on right-click. `right` is computed
  // from the click X so the popover stays anchored to the click point
  // without overflowing the viewport.
  const openFromContext = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const right = Math.max(8, window.innerWidth - e.clientX);
    menu.open({ top: e.clientY + 4, right });
  };

  return (
    <div class="main__graph-column-headers" ref={containerEl}>
      <For each={visible()}>
        {(id, idx) => (
          <span
            class="main__graph-column-header"
            data-zone={id}
            style={{ order: activeColumnSettings(id).order }}
            onContextMenu={openFromContext}
          >
            <HeaderLabel id={id} />
            {/* No resizer at the left edge of the first column —
                there's no left neighbour to redistribute width with. */}
            <Show when={idx() > 0}>
              <GraphColumnResizer
                leftZone={visible()[idx() - 1]}
                rightZone={id}
              />
            </Show>
          </span>
        )}
      </For>
      <Show when={menu.pos()}>
        <ColumnSettingsMenu pos={menu.pos()!} onClose={menu.close} />
      </Show>
    </div>
  );
}
