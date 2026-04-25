// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Header strip above the commit graph: column labels, resize handles
 * between them, and the column-settings ⚙ button (1:1 with GK's
 * column-header chrome). The labels iterate `ZONE_ORDER` filtered by
 * the user's visibility map, so ticking `Author` in the settings menu
 * surfaces it inline alongside the existing columns.
 *
 * The BRANCH/TAG header swaps `Branch / Tag` text for an inline group
 * that includes the `HiddenRefsButton` so the user always has a place
 * to restore hidden refs.
 */

import { createMemo, For, Show } from "solid-js";

import { graphColumnVisibility } from "../../state";
import { ColumnSettingsButton } from "./ColumnSettingsButton";
import { GraphColumnResizer } from "./GraphColumnResizer";
import { HiddenRefsButton } from "./HiddenRefsButton";
import { ZONE_ORDER, ZONE_SPECS, type GraphZoneId } from "./columns";

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
  const visibleZones = createMemo<GraphZoneId[]>(() =>
    ZONE_ORDER.filter((id) => graphColumnVisibility()[id]),
  );

  return (
    <div class="main__graph-column-headers">
      <For each={visibleZones()}>
        {(id, idx) => (
          <span
            class="main__graph-column-header"
            data-zone={id}
            classList={{
              "is-last": idx() === visibleZones().length - 1,
            }}
          >
            <HeaderLabel id={id} />
            <Show when={idx() < visibleZones().length - 1}>
              <GraphColumnResizer leftZone={id} />
            </Show>
          </span>
        )}
      </For>
      <ColumnSettingsButton />
    </div>
  );
}
