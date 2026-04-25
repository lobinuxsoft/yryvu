// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Header strip above the commit graph: column labels, resize handles
 * between them, and the column-settings ⚙ button (1:1 with GK's column
 * header chrome). Iterates `activeOrderedZones()` so the bundle's
 * compact-mode reordering (author left of message) falls out
 * automatically. Each header column reads its width from the active
 * slice of the column state.
 */

import { createMemo, For, Show } from "solid-js";

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
  // Same flex-grow target rule as the body — message wins when visible,
  // last-by-order wins otherwise. Keeps the header strip aligned with
  // the zones below at all times.
  const growZone = createMemo<GraphZoneId | undefined>(() => {
    const order = visible();
    if (order.includes("commitMessage")) return "commitMessage";
    return order[order.length - 1];
  });

  return (
    <div class="main__graph-column-headers">
      <For each={visible()}>
        {(id, idx) => (
          <span
            class="main__graph-column-header"
            data-zone={id}
            classList={{ "is-last-visible": growZone() === id }}
            style={{ order: activeColumnSettings(id).order }}
          >
            <HeaderLabel id={id} />
            <Show when={idx() < visible().length - 1}>
              <GraphColumnResizer leftZone={id} />
            </Show>
          </span>
        )}
      </For>
      <ColumnSettingsButton />
    </div>
  );
}
