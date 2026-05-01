// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";
import type { IntegrationState } from "./state";

/**
 * Disconnect button mirror of `bundle:165644`–`165648`. Only renders
 * when the integration is in the `connected` state.
 */
export function DisconnectButton(props: {
  state: IntegrationState;
  onDisconnect: () => void;
}): JSX.Element {
  return (
    <Show when={props.state.tag === "connected"}>
      <button
        class="integrations-btn integrations-btn--danger"
        type="button"
        onMouseDown={() => props.onDisconnect()}
      >
        Disconnect
      </button>
    </Show>
  );
}
