// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Header strip above the commit graph: column labels, resize handles
 * between them, and the column-settings ⚙ button (1:1 with GK's column
 * header chrome). Iterates `activeOrderedZones()` so the bundle's
 * compact-mode reordering (author left of message) falls out
 * automatically. Each header column reads its width from the active
 * slice of the column state.
 */

import { createMemo, For } from "solid-js";

import { activeColumnSettings, activeOrderedZones } from "../../state";
import { ColumnSettingsButton } from "./ColumnSettingsButton";
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

  return (
    <div class="main__graph-column-headers">
      <For each={visible()}>
        {(id) => (
          <span
            class="main__graph-column-header"
            data-zone={id}
            style={{ order: activeColumnSettings(id).order }}
          >
            <HeaderLabel id={id} />
            {/* Every column gets its own resize handle (including the
                rightmost one) — fixes #157, where the rightmost zone
                couldn't shrink to its declared `minimumWidth` because
                no handle controlled it. The handle always operates on
                the column it sits on, and `setGraphZoneWidth` clamps
                the result to `[minimumWidth, maximumWidth]`. */}
            <GraphColumnResizer leftZone={id} />
          </span>
        )}
      </For>
      <ColumnSettingsButton />
    </div>
  );
}
