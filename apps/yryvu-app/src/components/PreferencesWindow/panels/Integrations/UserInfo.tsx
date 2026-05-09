// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";
import type { IntegrationState } from "./state";
import type { ProviderInfo } from "./providerTable";

/**
 * Account user-info block mirror of `bundle:165650`–`165669`. Renders
 * either the connected user (avatar + displayName + login) or a
 * disconnected placeholder badge with the provider's initials.
 *
 * The disconnected placeholder uses the provider's badge (see
 * `providerTable.ts` deviation note) instead of GK's generic
 * user-circle so the user can tell which provider's row they're
 * looking at even before connecting.
 */
export function UserInfo(props: {
  state: IntegrationState;
  provider: ProviderInfo;
}): JSX.Element {
  const isConnected = () => props.state.tag === "connected";
  return (
    <div class="integrations-user-info">
      <Show
        when={isConnected() && props.state.tag === "connected" ? props.state.user : null}
        fallback={
          <span
            class="integrations-provider-badge integrations-provider-badge--lg"
            style={{ background: props.provider.colorAccent }}
            aria-hidden="true"
          >
            {props.provider.initials}
          </span>
        }
      >
        {(user) => (
          <>
            <Show
              when={user().avatarUrl}
              fallback={
                <span
                  class="integrations-provider-badge integrations-provider-badge--lg"
                  style={{ background: props.provider.colorAccent }}
                  aria-hidden="true"
                >
                  {props.provider.initials}
                </span>
              }
            >
              <img
                class="integrations-user-info__avatar"
                src={user().avatarUrl}
                alt={`${user().displayName} avatar`}
                width="40"
                height="40"
              />
            </Show>
            <span class="integrations-user-info__text">
              <span class="integrations-user-info__name">{user().displayName}</span>
              <span class="integrations-user-info__login">@{user().login}</span>
            </span>
          </>
        )}
      </Show>
    </div>
  );
}
