// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show, type JSX } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Dialog } from "../../../Dialog";
import { notify } from "../../../Notifications";
import type { ProviderInfo } from "./providerTable";
import { selfHostedHostname } from "./selfHostedHostnames";
import { buildTokenGenUrl, setIntegrationToken } from "./tokenStorage";

/**
 * Personal Access Token entry dialog. Mirror of GK's
 * `handleManualIntegrationTokenInput` flow (`bundle:146636`) plus the
 * `openLinkToGenerateToken` deep-link (`bundle:146668`).
 *
 * The same component handles every provider that accepts manual token
 * input — that's everyone except Trello (custom app-key+token, out of
 * scope for chajá v1).
 *
 * **chajá deviation**: GK leaves `generateTokenPath: null` for `.com`
 * providers (`bundle:166381`+); chajá fills these in with public
 * well-known URLs so the user always gets the deep-link button.
 *
 * Bitbucket relabeling: `tokenIsAppPassword` (`bundle:166682` flag)
 * drives the dialog title + button copy ("App Password" instead of
 * "Personal Access Token").
 */
export function PatEntryDialog(props: {
  open: boolean;
  provider: ProviderInfo;
  onClose: () => void;
  onSubmit: () => void;
}): JSX.Element {
  const [token, setToken] = createSignal("");
  const tokenLabel = () =>
    props.provider.tokenIsAppPassword ? "App Password" : "Personal Access Token";

  const tokenGenUrl = () =>
    buildTokenGenUrl(
      props.provider.tokenGenPath,
      props.provider.tokenGenParams,
      selfHostedHostname(props.provider.type)(),
    );

  const onGenerateClick = async () => {
    const url = tokenGenUrl();
    if (!url) {
      notify.info("No deep-link", {
        message: `${props.provider.label} doesn't expose a public token-creation URL.`,
      });
      return;
    }
    try {
      await openUrl(url);
    } catch (err) {
      notify.error("Failed to open browser", { message: String(err) });
    }
  };

  const submit = () => {
    const trimmed = token().trim();
    if (!trimmed) return;
    setIntegrationToken(props.provider.type, trimmed);
    setToken("");
    props.onSubmit();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && token().trim().length > 0) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog
      open={props.open}
      title={`${tokenLabel()} — ${props.provider.verboseLabel}`}
      onClose={props.onClose}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            data-testid="pat-entry-submit"
            disabled={token().trim().length === 0}
            onClick={submit}
          >
            Save
          </button>
        </>
      }
    >
      <div data-testid="pat-entry-dialog">
        <p class="dialog__hint">
          Paste your {tokenLabel()} below. chajá uses it to authenticate
          against {props.provider.verboseLabel}'s API. Tokens are stored
          locally; no other tokens are ever transmitted anywhere except to
          {" "}
          {props.provider.label}.
        </p>
        <Show when={tokenGenUrl()}>
          <button
            class="pat-entry__generate-link"
            type="button"
            data-testid="pat-entry-generate-link"
            onClick={() => void onGenerateClick()}
          >
            Generate {tokenLabel()} on {props.provider.label} →
          </button>
        </Show>
        <input
          type="password"
          autofocus
          data-testid="pat-entry-input"
          placeholder={
            props.provider.tokenIsAppPassword
              ? "Paste your App Password"
              : "Paste your token (e.g. ghp_xxxxxxxxxxxxxxxx)"
          }
          value={token()}
          onInput={(e) => setToken(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </Dialog>
  );
}
