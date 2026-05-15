// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show, type JSX } from "solid-js";
import { notify } from "../../../Notifications";
import { ConnectButton } from "./ConnectButton";
import { DisconnectButton } from "./DisconnectButton";
import { PatEntryDialog } from "./PatEntryDialog";
import { SelfHostedConfigurationDialog } from "./SelfHostedConfigurationDialog";
import { StatusPill } from "./StatusPill";
import { UserInfo } from "./UserInfo";
import type { ProviderInfo } from "./providerTable";
import {
  integrationState,
  setIntegrationState,
} from "./state";
import { selfHostedHostname } from "./selfHostedHostnames";
import { cancelOAuthFlow, startOAuthFlow } from "./tokenStorage";

/**
 * Reusable account-row form. Mirror of `bundle:165616` —
 * `IntegrationConnectionForm`. Reads from the static provider table
 * + the per-integration mocked state machine, dispatches `onConnect`
 * / `onDisconnect` via a transient toast since no backend is wired
 * yet.
 *
 * Self-hosted providers (`isSelfHosted: true`) gain an extra step
 * before Connect: the SelfHostedConfiguration dialog (#246, mirror of
 * `bundle:486`) collects the user's instance URL. Once stored, the
 * URL surfaces as the form's subtitle with an "Edit" button to
 * re-open the dialog.
 *
 * **Mocked state machine** (this PR scaffolds UI only):
 * - Connect (`.com` provider): disconnected → connecting (1s) → toast
 *   "Backend pendiente" → disconnected.
 * - Connect (self-hosted, no URL): opens SelfHostedConfigurationDialog;
 *   on submit, runs the same mocked flow.
 * - Connect (self-hosted, URL set): same as `.com` provider.
 * - Disconnect: connected → disconnecting (300ms) → disconnected.
 */
export function ConnectionForm(props: { provider: ProviderInfo }): JSX.Element {
  const state = () => integrationState(props.provider.type)();
  const hostname = () => selfHostedHostname(props.provider.type)();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [patDialogOpen, setPatDialogOpen] = createSignal(false);
  // Tracks the in-flight OAuth session so the user can cancel before
  // the browser round-trip completes. Cleared on completion / error.
  const [oauthSessionId, setOauthSessionId] = createSignal<string | null>(null);

  const tokenLabel = () =>
    props.provider.tokenIsAppPassword ? "App Password" : "Personal Access Token";
  const acceptsPat = () => props.provider.cohort !== "skip";
  const patBlocked = () => props.provider.isSelfHosted && !hostname();

  const handleUsePat = () => {
    if (!acceptsPat() || patBlocked()) return;
    setPatDialogOpen(true);
  };

  const onPatSubmit = () => {
    setPatDialogOpen(false);
    // saveToken (called inside PatEntryDialog.submit) already ran
    // integrationPreflight against the provider API and set the
    // `connected` state with the real UserInfo on success. No mocked
    // dance needed here — that would pisar el state correcto.
    //
    // For providers without a preflight client (NotImplemented),
    // saveToken keeps the persisted token but leaves state in
    // disconnected. The sidebar's "configured" indicator stays lit;
    // the form's avatar is still the badge placeholder. That's the
    // intended degraded mode until the per-provider client lands.
  };

  const startMockedConnect = () => {
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

  /**
   * Drive the real OAuth flow for providers whose `client_id` is baked
   * at compile time (currently github only). On `OAuthNotConfigured`
   * the chain falls back to the mocked path so non-baked providers
   * still surface the existing "PR siguiente" toast instead of a
   * confusing error.
   */
  const startRealOAuth = async () => {
    setIntegrationState(props.provider.type, { tag: "connecting" });
    try {
      const sid = await startOAuthFlow(props.provider.type, hostname() || undefined);
      setOauthSessionId(sid);
      // saveToken (called inside startOAuthFlow) already set the
      // connected state with the real UserInfo on success — nothing
      // else to do here.
    } catch (err) {
      const msg = String(err);
      if (msg.includes("OAuth not configured")) {
        setIntegrationState(props.provider.type, {
          tag: "disconnected",
          reason: "user_initiated",
        });
        notify.info("OAuth pendiente", {
          message: `${props.provider.label} no tiene client_id baked todavía. Usá un PAT por ahora.`,
        });
        return;
      }
      if (msg.includes("OAuth flow cancelled by user")) {
        setIntegrationState(props.provider.type, {
          tag: "disconnected",
          reason: "user_initiated",
        });
        return;
      }
      setIntegrationState(props.provider.type, {
        tag: "disconnected",
        reason: "user_initiated",
      });
      notify.error("Conexión fallida", { message: msg });
    } finally {
      setOauthSessionId(null);
    }
  };

  const handleConnect = () => {
    if (state().tag !== "disconnected") return;
    if (props.provider.isSelfHosted && !hostname()) {
      setDialogOpen(true);
      return;
    }
    if (props.provider.authType === "OAUTH") {
      void startRealOAuth();
      return;
    }
    startMockedConnect();
  };

  const handleCancelOAuth = () => {
    const sid = oauthSessionId();
    if (sid) {
      void cancelOAuthFlow(sid);
      setOauthSessionId(null);
    }
    setIntegrationState(props.provider.type, {
      tag: "disconnected",
      reason: "user_initiated",
    });
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

  const onDialogSubmit = () => {
    setDialogOpen(false);
    if (props.provider.authType === "OAUTH") {
      void startRealOAuth();
      return;
    }
    startMockedConnect();
  };

  return (
    <>
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
              <Show
                when={props.provider.isSelfHosted}
                fallback={props.provider.hostnameLabel}
              >
                <Show
                  when={hostname()}
                  fallback={<em>URL not configured</em>}
                >
                  <span class="integrations-form__hostname">{hostname()}</span>
                  <button
                    class="integrations-form__edit"
                    type="button"
                    onClick={() => setDialogOpen(true)}
                  >
                    Edit
                  </button>
                </Show>
              </Show>
              <span class="integrations-form__sep">•</span>
              {props.provider.authType === "OAUTH" ? "OAuth" : tokenLabel()}
            </span>
          </div>
        </div>

        <div class="integrations-form__row">
          <UserInfo state={state()} provider={props.provider} />
          <div class="integrations-form__actions">
            <StatusPill state={state()} />
            <Show when={oauthSessionId() !== null && state().tag === "connecting"}>
              <button
                class="integrations-btn integrations-btn--danger"
                type="button"
                onClick={handleCancelOAuth}
              >
                Cancel
              </button>
            </Show>
            <ConnectButton
              state={state()}
              provider={props.provider}
              onConnect={handleConnect}
            />
            <DisconnectButton state={state()} onDisconnect={handleDisconnect} />
          </div>
        </div>

        <Show when={acceptsPat() && state().tag === "disconnected"}>
          <button
            class="integrations-form__pat-link"
            type="button"
            disabled={patBlocked()}
            title={
              patBlocked()
                ? "Configure the instance URL first"
                : undefined
            }
            onClick={handleUsePat}
          >
            Use {props.provider.tokenIsAppPassword ? "an" : "a"} {tokenLabel()} instead
          </button>
        </Show>

        <p class="integrations-form__hint">
          {props.provider.cohort === "skip"
            ? "Trello uses a custom app-key + token flow that yryvu does not plan to implement."
            : props.provider.isSelfHosted && !hostname()
              ? `Enter your ${props.provider.label} instance URL to continue.`
              : props.provider.cohort === "v2"
                ? "Self-hosted variant — ships in v2 with the custom-hostname plumbing."
                : props.provider.authType === "OAUTH"
                  ? `Click Connect to authorize yryvu against ${props.provider.label}.`
                  : `Click Connect to enter a Personal Access Token for ${props.provider.label}.`}
        </p>
      </div>

      <Show when={props.provider.isSelfHosted}>
        <SelfHostedConfigurationDialog
          open={dialogOpen()}
          provider={props.provider}
          onClose={() => setDialogOpen(false)}
          onSubmit={onDialogSubmit}
        />
      </Show>

      <Show when={acceptsPat()}>
        <PatEntryDialog
          open={patDialogOpen()}
          provider={props.provider}
          onClose={() => setPatDialogOpen(false)}
          onSubmit={onPatSubmit}
        />
      </Show>
    </>
  );
}
