// SPDX-License-Identifier: AGPL-3.0-or-later

import { type JSX } from "solid-js";
import { notify } from "../../../Notifications";
import { ConnectButton } from "./ConnectButton";
import { DisconnectButton } from "./DisconnectButton";
import { StatusPill } from "./StatusPill";
import { UserInfo } from "./UserInfo";
import type { ProviderInfo } from "./providerTable";
import {
  integrationState,
  setIntegrationState,
} from "./state";

/**
 * Reusable account-row form. Mirror of `bundle:165616` —
 * `IntegrationConnectionForm`. Reads from the static provider table
 * + the per-integration mocked state machine, dispatches `onConnect`
 * / `onDisconnect` via a transient toast since no backend is wired
 * yet.
 *
 * **Mocked state machine** (this PR scaffolds UI only):
 * - Connect: disconnected → connecting (1s) → toast "Backend pendiente"
 *   → disconnected (no real auth yet, the connected branch is reachable
 *   only via dev tooling for visual QA).
 * - Disconnect: connected → disconnecting (300ms) → disconnected.
 *
 * Once OAuth lands (cluster post-#46), swap the timeout-based mock for
 * the real `sendAuthorizationRequest` IPC call. The discriminated-union
 * state shape stays.
 */
export function ConnectionForm(props: { provider: ProviderInfo }): JSX.Element {
  const state = () => integrationState(props.provider.type)();

  const handleConnect = () => {
    if (state().tag !== "disconnected") return;
    setIntegrationState(props.provider.type, { tag: "connecting" });
    setTimeout(() => {
      setIntegrationState(props.provider.type, {
        tag: "disconnected",
        reason: "user_initiated",
      });
      notify.info("Backend pendiente", {
        message: `${props.provider.label} OAuth llega en una PR siguiente.`,
      });
    }, 1000);
  };

  const handleDisconnect = () => {
    if (state().tag !== "connected") return;
    setIntegrationState(props.provider.type, { tag: "disconnecting" });
    setTimeout(() => {
      setIntegrationState(props.provider.type, {
        tag: "disconnected",
        reason: "user_initiated",
      });
    }, 300);
  };

  return (
    <div class="integrations-form">
      <div class="integrations-form__header">
        <span
          class="integrations-provider-badge"
          style={{ background: props.provider.colorAccent }}
          aria-hidden="true"
        >
          {props.provider.initials}
        </span>
        <div class="integrations-form__heading">
          <h4 class="integrations-form__title">{props.provider.verboseLabel}</h4>
          <span class="integrations-form__subtitle">
            {props.provider.hostnameLabel}
            <span class="integrations-form__sep">•</span>
            {props.provider.authType === "OAUTH" ? "OAuth" : "Personal Access Token"}
          </span>
        </div>
      </div>

      <div class="integrations-form__row">
        <UserInfo state={state()} provider={props.provider} />
        <div class="integrations-form__actions">
          <StatusPill state={state()} />
          <ConnectButton
            state={state()}
            provider={props.provider}
            onConnect={handleConnect}
          />
          <DisconnectButton state={state()} onDisconnect={handleDisconnect} />
        </div>
      </div>

      <p class="integrations-form__hint">
        {props.provider.cohort === "skip"
          ? "Trello uses a custom app-key + token flow that chajá does not plan to implement."
          : props.provider.cohort === "v2"
            ? "Self-hosted variant — ships in v2 with the custom-hostname plumbing."
            : props.provider.authType === "OAUTH"
              ? `Click Connect to authorize chajá against ${props.provider.label}.`
              : `Click Connect to enter a Personal Access Token for ${props.provider.label}.`}
      </p>
    </div>
  );
}
