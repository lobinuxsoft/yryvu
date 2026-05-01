// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, type JSX } from "solid-js";
import { PROVIDERS, type IntegrationType } from "./providerTable";
import { integrationState } from "./state";

/**
 * Provider sub-tab sidebar — the left rail inside Preferences >
 * Integrations. Mirror of `bundle:119112`'s
 * `orderedIntegrationSubTabTypes` rendering. Each row shows the
 * provider's badge + label + a tiny status dot reflecting the
 * current connection state so the user can see at a glance which
 * providers are connected.
 */
export function SubTabSidebar(props: {
  active: IntegrationType;
  onSelect: (type: IntegrationType) => void;
}): JSX.Element {
  return (
    <nav class="integrations-subtab" aria-label="Integration providers">
      <For each={PROVIDERS}>
        {(provider) => {
          const isActive = () => props.active === provider.type;
          const isConnected = () =>
            integrationState(provider.type)().tag === "connected";
          return (
            <button
              type="button"
              class="integrations-subtab__item"
              classList={{
                "integrations-subtab__item--active": isActive(),
              }}
              role="tab"
              aria-selected={isActive()}
              tabIndex={isActive() ? 0 : -1}
              onClick={() => props.onSelect(provider.type)}
            >
              <span
                class="integrations-provider-badge integrations-provider-badge--sm"
                style={{ background: provider.colorAccent }}
                aria-hidden="true"
              >
                {provider.initials}
              </span>
              <span class="integrations-subtab__label">{provider.label}</span>
              <span
                class="integrations-subtab__indicator"
                classList={{
                  "integrations-subtab__indicator--connected": isConnected(),
                }}
                aria-label={isConnected() ? "Connected" : "Not connected"}
                title={isConnected() ? "Connected" : "Not connected"}
              />
            </button>
          );
        }}
      </For>
    </nav>
  );
}
