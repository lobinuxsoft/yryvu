// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, onMount, Show, type JSX } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  getCustomOAuthApp,
  removeCustomOAuthApp,
  saveCustomOAuthApp,
} from "../../../../ipc/integrations/credentials";
import { notify } from "../../../Notifications";
import type { ProviderInfo } from "./providerTable";

const REGISTER_URL: Record<string, string> = {
  github: "https://github.com/settings/developers",
  gitlab: "https://gitlab.com/-/user_settings/applications",
  bitbucket:
    "https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/",
};

/// "Use my own OAuth App" override, collapsed under Advanced. Disconnect
/// first to change it: a live token was minted by the previous app.
export function CustomOAuthApp(props: { provider: ProviderInfo }): JSX.Element {
  const [clientId, setClientId] = createSignal("");
  const [secret, setSecret] = createSignal("");
  const [saved, setSaved] = createSignal(false);

  onMount(async () => {
    const app = await getCustomOAuthApp(props.provider.type).catch(() => null);
    if (app) {
      setClientId(app.clientId);
      setSaved(true);
    }
  });

  const save = async () => {
    try {
      await saveCustomOAuthApp(props.provider.type, clientId(), secret());
      setSecret("");
      setSaved(true);
      notify.success("OAuth App saved", { message: props.provider.label });
    } catch (e) {
      notify.error("Could not save OAuth App", { message: String(e) });
    }
  };

  const remove = async () => {
    try {
      await removeCustomOAuthApp(props.provider.type);
      setClientId("");
      setSecret("");
      setSaved(false);
    } catch (e) {
      notify.error("Could not remove OAuth App", { message: String(e) });
    }
  };

  return (
    <details class="integrations-form__advanced" data-testid="custom-oauth-app">
      <summary>Advanced — use my own OAuth App{saved() ? " (active)" : ""}</summary>
      <div class="integrations-form__advanced-body">
        <input
          type="text"
          placeholder="Client ID"
          value={clientId()}
          onInput={(e) => setClientId(e.currentTarget.value)}
        />
        <input
          type="password"
          placeholder={saved() ? "Client secret (saved — type to replace)" : "Client secret"}
          value={secret()}
          onInput={(e) => setSecret(e.currentTarget.value)}
        />
        <p class="integrations-form__hint">
          Register the app with callback <code>http://127.0.0.1</code> (any port).
          <Show when={REGISTER_URL[props.provider.type]}>
            {(url) => (
              <>
                {" "}
                <button
                  class="integrations-form__pat-link"
                  type="button"
                  onClick={() => void openUrl(url())}
                >
                  How to register
                </button>
              </>
            )}
          </Show>
        </p>
        <div class="integrations-form__advanced-actions">
          <button
            class="integrations-btn integrations-btn--primary"
            type="button"
            disabled={!clientId().trim() || !secret().trim()}
            onClick={() => void save()}
          >
            Save
          </button>
          <Show when={saved()}>
            <button class="integrations-btn" type="button" onClick={() => void remove()}>
              Use yryvu's app
            </button>
          </Show>
        </div>
      </div>
    </details>
  );
}
