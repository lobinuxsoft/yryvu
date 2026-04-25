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

  return (
    <div class="main__graph-column-headers">
      <For each={visible()}>
        {(id, idx) => (
          <span
            class="main__graph-column-header"
            data-zone={id}
            style={{ order: activeColumnSettings(id).order }}
          >
            <HeaderLabel id={id} />
            <Show when={idx() < visible().length - 1}>
              <GraphColumnResizer leftZone={id} />
            </Show>
          </span>
        )}
      </For>
      <span
        class="main__graph-column-header main__graph-column-header--filler"
        style={{ order: 100 }}
      />
      <ColumnSettingsButton />
    </div>
  );
}
