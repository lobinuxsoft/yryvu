// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, Show, type JSX } from "solid-js";

import {
  readSshPublicKey,
  testSshConnection,
  type SshTestResult,
} from "../../../ipc";
import {
  authEnv,
  openSshKeyGen,
  primeAuthEnv,
  preferences,
  updatePreferences,
} from "../../../state";
import { notify } from "../../Notifications";

/**
 * SSH preferences panel (#47). Surfaces the credential environment +
 * every key the generation wizard minted (host → path, persisted in
 * the `ssh` preferences section), with the actions that stay useful
 * across sessions: copy the public key, re-test the connection,
 * forget the record, or mint another key.
 *
 * GK deviation, documented: GK's panel also offers a "Use local SSH
 * agent" toggle + explicit private/public key path pickers
 * (`useLocalSSHAgent`, `SSHConfig-SSHPrivateKey/PublicKey` in the
 * bundle). yryvu's credential callback authenticates exclusively via
 * the agent today — shipping those controls now would be dead toggles,
 * so they wait until the callback honours explicit keypairs.
 */
export function SshPanel(): JSX.Element {
  const [tests, setTests] = createSignal<
    Record<string, SshTestResult | "testing">
  >({});

  const keys = () => Object.entries(preferences()?.ssh.keyPaths ?? {});
  const ready = () => preferences() !== undefined;
  const env = authEnv;

  async function copyPublicKey(path: string) {
    try {
      const pub = await readSshPublicKey(path);
      await navigator.clipboard.writeText(pub);
      notify.success("Public key copied", {
        message: "Paste it into your provider's SSH settings.",
      });
    } catch (e) {
      notify.error("Could not read the public key", { message: String(e) });
    }
  }

  async function runTest(host: string, path: string) {
    setTests((t) => ({ ...t, [host]: "testing" }));
    try {
      // Pin the test to this key — agent contents must not turn a
      // correctly-installed key into a false negative.
      const result = await testSshConnection(host, path);
      setTests((t) => ({ ...t, [host]: result }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [host]: { authenticated: false, message: String(e) },
      }));
    }
  }

  async function forget(host: string) {
    const current = { ...(preferences()?.ssh.keyPaths ?? {}) };
    delete current[host];
    try {
      await updatePreferences({ ssh: { keyPaths: current } });
      notify.info("Key record removed", {
        message: "The key files under ~/.ssh are untouched.",
      });
    } catch (e) {
      notify.error("Could not update preferences", { message: String(e) });
    }
  }

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">SSH agent</h3>
      <p class="ui-panel__helper">
        Pushes and fetches over SSH authenticate through your running
        ssh-agent.
      </p>
      <div class="ssh-panel__agent-row">
        <span>
          {env()
            ? env()!.sshAgentSocket
              ? `Agent running — ${env()!.sshKeysLoaded} ${
                  env()!.sshKeysLoaded === 1 ? "key" : "keys"
                } loaded`
              : "No ssh-agent reachable (SSH_AUTH_SOCK unset)"
            : "Environment not probed yet"}
        </span>
        <button
          type="button"
          class="dialog__btn"
          onClick={() => void primeAuthEnv()}
        >
          Re-probe
        </button>
      </div>

      <h3 class="preferences__section-title gpg-panel__sub-heading">
        Generated keys
      </h3>
      <p class="ui-panel__helper">
        Keys created by the in-app generation flow, recorded per host.
        "Forget" only removes the record — the files under{" "}
        <code>~/.ssh</code> stay.
      </p>

      <Show
        when={keys().length > 0}
        fallback={
          <p class="ui-panel__helper">
            <em>No generated keys yet.</em>
          </p>
        }
      >
        <For each={keys()}>
          {([host, path]) => {
            const result = () => tests()[host];
            return (
              <div class="ssh-panel__key">
                <div class="ssh-panel__key-head">
                  <span class="ssh-panel__key-host">{host}</span>
                  <code class="ssh-panel__key-path">{path}</code>
                </div>
                <div class="ssh-panel__key-actions">
                  <button
                    type="button"
                    class="dialog__btn"
                    onClick={() => void copyPublicKey(path)}
                  >
                    Copy public key
                  </button>
                  <button
                    type="button"
                    class="dialog__btn"
                    disabled={result() === "testing"}
                    onClick={() => void runTest(host, path)}
                  >
                    {result() === "testing" ? "Testing…" : "Test connection"}
                  </button>
                  <button
                    type="button"
                    class="dialog__btn dialog__btn--danger"
                    onClick={() => void forget(host)}
                  >
                    Forget
                  </button>
                </div>
                <Show when={result() && result() !== "testing"}>
                  {(() => {
                    const r = result() as SshTestResult;
                    return (
                      <p
                        class={
                          r.authenticated ? "ui-panel__helper" : "dialog__warning"
                        }
                      >
                        {r.authenticated
                          ? `Authenticated ✓ ${r.message}`
                          : `Not authenticated: ${r.message}`}
                      </p>
                    );
                  })()}
                </Show>
              </div>
            );
          }}
        </For>
      </Show>

      <div class="gpg-panel__actions">
        <button
          type="button"
          class="dialog__btn dialog__btn--primary"
          disabled={!ready()}
          onClick={() => openSshKeyGen("unknown")}
        >
          Generate SSH key
        </button>
      </div>
    </div>
  );
}
