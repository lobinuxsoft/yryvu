// SPDX-License-Identifier: AGPL-3.0-or-later

import { type JSX } from "solid-js";
import type { IntegrationState } from "./state";

/**
 * Connection-status pill mirror of `bundle:165670`–`165682`. Three
 * states: disconnected (red ban), connected (green check), connecting
 * (orange spinner). Mirrors the verbatim
 * `data-testid="integration-connection-status"` selector from the GK
 * bundle so future Playwright e2e fixtures can target it cross-app.
 */
export function StatusPill(props: { state: IntegrationState }): JSX.Element {
  // Read `props.state` inline on every access — destructuring (e.g.
  // `const { state } = props`) snapshots the value at first render
  // and breaks Solid reactivity, leaving the pill frozen on whatever
  // state the component first saw.
  switch (props.state.tag) {
    case "connected":
      return (
        <span
          class="integrations-status-pill integrations-status-pill--connected"
          data-testid="integration-connection-status"
        >
          <span class="integrations-status-pill__dot" />
          Connected
        </span>
      );
    case "connecting":
    case "disconnecting":
      return (
        <span
          class="integrations-status-pill integrations-status-pill--connecting"
          data-testid="integration-connection-status"
        >
          <span class="integrations-status-pill__dot integrations-status-pill__dot--spinning" />
          {props.state.tag === "connecting" ? "Connecting…" : "Disconnecting…"}
        </span>
      );
    case "disconnected":
      return (
        <span
          class="integrations-status-pill integrations-status-pill--disconnected"
          data-testid="integration-connection-status"
        >
          <span class="integrations-status-pill__dot" />
          Not Connected
        </span>
      );
  }
}
