// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show, type JSX } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  addSshKeyToAgent,
  generateSshKey,
  testSshConnection,
  type GeneratedSshKey,
  type SshTestResult,
} from "../../ipc";
import {
  closeSshKeyGen,
  preferences,
  primeAuthEnv,
  sshKeyGen,
  updatePreferences,
} from "../../state";
import { Dialog } from "../Dialog";
import { notify } from "../Notifications";
import { defaultSshHost, sshDocsUrl, sshSettingsUrl } from "./sshDocs";

type Phase =
  | { kind: "form" }
  | { kind: "generating" }
  | { kind: "success"; key: GeneratedSshKey; hadPassphrase: boolean }
  | { kind: "error"; message: string };

/**
 * Guided SSH key generation flow (#47), replacing the wizard's
 * external-docs fallback. Phase FSM mirrors `GenerateGpgKeyDialog`:
 * form → generating → success | error. The success step covers the
 * install half of the guide: copy the public key, deep-link the
 * provider's SSH settings, optionally load the key into the agent, and
 * verify with a real `ssh -T` round-trip.
 *
 * Deviation from the issue body, documented: no provider-API polling
 * to auto-detect the installed key — polling needs a PAT, and this
 * wizard exists precisely because the user has no credentials yet.
 * "Test connection" is the authoritative validation instead.
 */
export function SshKeyGenDialog(): JSX.Element {
  const [algorithm, setAlgorithm] = createSignal<"ed25519" | "rsa4096">(
    "ed25519",
  );
  const [passphrase, setPassphrase] = createSignal("");
  const [host, setHost] = createSignal<string | null>(null);
  const [phase, setPhase] = createSignal<Phase>({ kind: "form" });
  const [testResult, setTestResult] = createSignal<SshTestResult | null>(null);
  const [testing, setTesting] = createSignal(false);
  const [agentLoaded, setAgentLoaded] = createSignal(false);

  const provider = () => sshKeyGen()?.provider ?? "unknown";
  /// Host is user-editable for self-hosted instances; null = untouched
  /// → provider default.
  const effectiveHost = () => host() ?? defaultSshHost(provider());

  function close() {
    setAlgorithm("ed25519");
    setPassphrase("");
    setHost(null);
    setPhase({ kind: "form" });
    setTestResult(null);
    setTesting(false);
    setAgentLoaded(false);
    closeSshKeyGen();
  }

  async function handleGenerate() {
    const h = effectiveHost().trim();
    if (!h) {
      setPhase({ kind: "error", message: "Host is required." });
      return;
    }
    setPhase({ kind: "generating" });
    try {
      const key = await generateSshKey({
        algorithm: algorithm(),
        comment: `yryvu@${h}`,
        passphrase: passphrase(),
        fileName: `yryvu_${h.replace(/[^A-Za-z0-9]+/g, "_")}`,
      });
      setPhase({ kind: "success", key, hadPassphrase: passphrase() !== "" });
      setPassphrase("");
      // Acceptance: private key path recorded in settings, reused
      // across sessions. Best effort — the key itself already exists.
      try {
        await updatePreferences({
          ssh: {
            keyPaths: {
              ...(preferences()?.ssh.keyPaths ?? {}),
              [h]: key.privateKeyPath,
            },
          },
        });
      } catch (e) {
        notify.error("Could not record the key path in preferences", {
          message: String(e),
        });
      }
    } catch (e) {
      setPhase({ kind: "error", message: String(e) });
    }
  }

  async function copyPublicKey() {
    const p = phase();
    if (p.kind !== "success") return;
    try {
      await navigator.clipboard.writeText(p.key.publicKey);
      notify.success("Public key copied", {
        message: "Paste it into your provider's SSH settings.",
      });
    } catch (e) {
      notify.error("Copy failed", { message: String(e) });
    }
  }

  function openSettings() {
    openUrl(sshSettingsUrl(provider(), effectiveHost())).catch((err) =>
      notify.error("Failed to open browser", { message: String(err) }),
    );
  }

  async function loadIntoAgent() {
    const p = phase();
    if (p.kind !== "success") return;
    try {
      await addSshKeyToAgent(p.key.privateKeyPath);
      setAgentLoaded(true);
      notify.success("Key loaded into ssh-agent", {
        message: p.key.privateKeyPath,
      });
      void primeAuthEnv();
    } catch (e) {
      notify.error("ssh-add failed", { message: String(e) });
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testSshConnection(effectiveHost().trim()));
    } catch (e) {
      setTestResult({ authenticated: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Show when={sshKeyGen()}>
      <Dialog
        open
        title="Generate SSH key"
        size={phase().kind === "success" ? "wide" : "default"}
        onClose={close}
        footer={
          <Show
            when={phase().kind === "success"}
            fallback={
              <>
                <button class="dialog__btn" type="button" onClick={close}>
                  Cancel
                </button>
                <button
                  class="dialog__btn dialog__btn--primary"
                  type="button"
                  disabled={phase().kind === "generating"}
                  onClick={() => void handleGenerate()}
                >
                  {phase().kind === "generating" ? "Generating…" : "Generate"}
                </button>
              </>
            }
          >
            <button
              class="dialog__btn dialog__btn--primary"
              type="button"
              onClick={() => void copyPublicKey()}
            >
              Copy public key
            </button>
            <button class="dialog__btn" type="button" onClick={close}>
              Done
            </button>
          </Show>
        }
      >
        <Show when={phase().kind === "form" || phase().kind === "generating"}>
          <p class="dialog__hint">
            Creates a key under <code>~/.ssh</code> (private key mode 0600)
            and walks you through installing it on your provider.{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                void openUrl(sshDocsUrl(provider()));
              }}
            >
              Provider SSH guide
            </a>
          </p>
          <label class="dialog__field">
            <span>Algorithm</span>
            <select
              value={algorithm()}
              onChange={(e) =>
                setAlgorithm(e.currentTarget.value as "ed25519" | "rsa4096")
              }
              disabled={phase().kind === "generating"}
            >
              <option value="ed25519">Ed25519 (recommended)</option>
              <option value="rsa4096">RSA 4096</option>
            </select>
          </label>
          <label class="dialog__field">
            <span>Host</span>
            <input
              type="text"
              value={effectiveHost()}
              placeholder="github.com"
              onInput={(e) => setHost(e.currentTarget.value)}
              disabled={phase().kind === "generating"}
            />
          </label>
          <label class="dialog__field">
            <span>Passphrase (optional)</span>
            <input
              type="password"
              value={passphrase()}
              placeholder="Leave empty for no passphrase"
              onInput={(e) => setPassphrase(e.currentTarget.value)}
              disabled={phase().kind === "generating"}
            />
          </label>
          <Show when={algorithm() === "rsa4096"}>
            <p class="dialog__hint">RSA 4096 takes a few seconds to generate.</p>
          </Show>
        </Show>

        <Show when={phase().kind === "success"}>
          {(() => {
            const p = phase() as Extract<Phase, { kind: "success" }>;
            return (
              <>
                <p class="dialog__hint">
                  Key written to <code>{p.key.privateKeyPath}</code> —
                  fingerprint <code>{p.key.fingerprint}</code>. Copy the
                  public key, add it on your provider, then test the
                  connection.
                </p>
                <textarea
                  class="dialog__armored"
                  readonly
                  rows="4"
                  value={p.key.publicKey}
                />
                <div class="cred-setup__cmd-row">
                  <button class="dialog__btn" type="button" onClick={openSettings}>
                    Open SSH settings →
                  </button>
                  <Show
                    when={!p.hadPassphrase}
                    fallback={
                      <span class="dialog__hint">
                        Load it with <code>ssh-add {p.key.privateKeyPath}</code>{" "}
                        (it has a passphrase).
                      </span>
                    }
                  >
                    <button
                      class="dialog__btn"
                      type="button"
                      disabled={agentLoaded()}
                      onClick={() => void loadIntoAgent()}
                    >
                      {agentLoaded() ? "Loaded into agent ✓" : "Load into agent"}
                    </button>
                  </Show>
                  <button
                    class="dialog__btn"
                    type="button"
                    disabled={testing()}
                    onClick={() => void runTest()}
                  >
                    {testing() ? "Testing…" : "Test connection"}
                  </button>
                </div>
                <Show when={testResult()}>
                  {(r) => (
                    <p
                      class={
                        r().authenticated ? "dialog__hint" : "dialog__warning"
                      }
                      data-testid="ssh-test-result"
                    >
                      {r().authenticated
                        ? `Authenticated ✓ ${r().message}`
                        : `Not authenticated: ${r().message}`}
                    </p>
                  )}
                </Show>
              </>
            );
          })()}
        </Show>

        <Show when={phase().kind === "error"}>
          {(() => {
            const p = phase() as Extract<Phase, { kind: "error" }>;
            return (
              <>
                <p class="dialog__warning">{p.message}</p>
                <button
                  class="dialog__btn"
                  type="button"
                  onClick={() => setPhase({ kind: "form" })}
                >
                  Back
                </button>
              </>
            );
          })()}
        </Show>
      </Dialog>
    </Show>
  );
}
