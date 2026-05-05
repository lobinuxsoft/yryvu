// SPDX-License-Identifier: AGPL-3.0-or-later

import { type JSX } from "solid-js";
import type { IntegrationState } from "./state";
import type { ProviderInfo } from "./providerTable";

/**
 * Connect / Refresh button mirror of `bundle:165635`–`165643`. When
 * disconnected, label is `"Connect to <provider>"`; when connected,
 * label is `"Refresh"`. Uses `onMouseDown` (not `onClick`) per GK's
 * `convertOnClickToOnMouseDown` perf hack — starts the auth dance
 * a few ms earlier on slow systems.
 */
export function ConnectButton(props: {
  state: IntegrationState;
  provider: ProviderInfo;
  onConnect: () => void;
}): JSX.Element {
  const isBusy = () =>
    props.state.tag === "connecting" || props.state.tag === "disconnecting";
  const isConnected = () => props.state.tag === "connected";

  return (
    <button
      class="integrations-btn integrations-btn--primary"
      type="button"
      data-testid="connect-integration-button"
      disabled={isBusy()}
      onMouseDown={() => {
        if (isBusy()) return;
        props.onConnect();
      }}
    >
      {isConnected() ? "Refresh" : `Connect to ${props.provider.label}`}
    </button>
  );
}
