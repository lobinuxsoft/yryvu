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

import { createMemo, For, Show } from "solid-js";

import { activeColumnSettings, activeOrderedZones } from "../../state";
import {
  ColumnSettingsMenu,
  createMenuState,
} from "./ColumnSettingsButton";
import { GraphColumnResizer } from "./GraphColumnResizer";
import { HiddenRefsButton } from "./HiddenRefsButton";
import { ZONE_SPECS, type GraphZoneId } from "./columns";
import { IconFilter } from "../Icons";

function HeaderLabel(props: { id: GraphZoneId }) {
  if (props.id === "ref") {
    return (
      <span class="main__graph-column-header-branch">
        <span>{ZONE_SPECS.ref.label}</span>
        <HiddenRefsButton />
      </span>
    );
  }
  if (props.id === "commitAuthor") {
    return (
      <span class="main__graph-column-header-author">
        <span>{ZONE_SPECS.commitAuthor.label}</span>
        <button
          type="button"
          class="author-filter__btn"
          title="Filter the graph by author"
          aria-label="Filter authors"
          disabled
        >
          <IconFilter width={12} height={12} />
        </button>
      </span>
    );
  }
  return <span class="main__graph-column-label">{ZONE_SPECS[props.id].label}</span>;
}

export function GraphColumnHeaders() {
  const visible = createMemo(() => activeOrderedZones());
  const menu = createMenuState();

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
    <div class="main__graph-column-headers">
      <For each={visible()}>
        {(id) => (
          <span
            class="main__graph-column-header"
            data-zone={id}
            style={{ order: activeColumnSettings(id).order }}
            onContextMenu={openFromContext}
          >
            <HeaderLabel id={id} />
            <GraphColumnResizer leftZone={id} />
          </span>
        )}
      </For>
      <Show when={menu.pos()}>
        <ColumnSettingsMenu pos={menu.pos()!} onClose={menu.close} />
      </Show>
    </div>
  );
}
