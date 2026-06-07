// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Dialog } from "../Dialog";
import { notify } from "../Notifications";
import {
  credentialWizard,
  closeCredentialWizard,
  openPreferences,
} from "../../state";
import { ghInstallCommand, sshDocsUrl } from "./sshDocs";

/**
 * Credential setup wizard (#44). Opens when push / delete-remote fails
 * because libgit2 found no usable credentials. Offers the three recovery
 * paths from the auth-UX plan: install `gh`, configure SSH, or paste a
 * PAT — degrading gracefully on each (the in-app SSH generation flow #47
 * doesn't exist yet, so that path deep-links the provider's docs).
 */
export function CredentialSetupDialog(): JSX.Element {
  const state = credentialWizard;

  const copyGhCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      notify.success("Copied", { message: "Install command on your clipboard." });
    } catch {
      notify.error("Copy failed", { message: "Clipboard is unavailable." });
    }
  };

  const open = (url: string) => {
    openUrl(url).catch((err) =>
      notify.error("Failed to open browser", { message: String(err) }),
    );
  };

  const goToPat = () => {
    closeCredentialWizard();
    openPreferences("integrations");
  };

  return (
    <Show when={state()}>
      {(s) => {
        const ghCmd = ghInstallCommand(s().env.hostOs);
        return (
          <Dialog
            open
            title="Set up credentials"
            onClose={closeCredentialWizard}
            footer={
              <button
                class="dialog__btn"
                type="button"
                data-dismiss
                onClick={closeCredentialWizard}
              >
                Close
              </button>
            }
          >
            <div data-testid="credential-setup-dialog">
              <p class="dialog__warning">
                That remote operation needs credentials, but none were usable.
              </p>
              <p class="dialog__hint">
                yryvu tried your SSH agent
                {s().env.sshAgentSocket
                  ? s().env.sshKeysLoaded === 0
                    ? " (running, but no keys loaded)"
                    : ""
                  : " (not running)"}
                {s().env.credentialHelper
                  ? `, the git credential helper (${s().env.credentialHelper})`
                  : ", no git credential helper is configured"}
                , and your saved tokens. Pick a way to authenticate:
              </p>

              <section class="cred-setup__option">
                <h3 class="cred-setup__option-title">Paste a token</h3>
                <p class="cred-setup__option-body">
                  Fastest fix. Generate a Personal Access Token and store it in
                  your OS keyring.
                </p>
                <button
                  class="dialog__btn dialog__btn--primary"
                  type="button"
                  data-testid="cred-setup-pat"
                  onClick={goToPat}
                >
                  Open token settings →
                </button>
              </section>

              <section class="cred-setup__option">
                <h3 class="cred-setup__option-title">Configure SSH</h3>
                <p class="cred-setup__option-body">
                  Generate an SSH key and add it to your account, then load it
                  into your agent with <code>ssh-add</code>.
                </p>
                <button
                  class="dialog__btn"
                  type="button"
                  data-testid="cred-setup-ssh"
                  onClick={() => open(sshDocsUrl(s().provider))}
                >
                  Open SSH guide →
                </button>
              </section>

              <section class="cred-setup__option">
                <h3 class="cred-setup__option-title">Install the GitHub CLI</h3>
                <p class="cred-setup__option-body">
                  After <code>gh auth login</code>, yryvu can import the token
                  from your <code>gh</code> session.
                </p>
                <Show when={ghCmd}>
                  {(cmd) => (
                    <div class="cred-setup__cmd-row">
                      <code class="cred-setup__cmd">{cmd()}</code>
                      <button
                        class="dialog__btn"
                        type="button"
                        data-testid="cred-setup-gh-copy"
                        onClick={() => void copyGhCommand(cmd())}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                </Show>
                <button
                  class="dialog__btn"
                  type="button"
                  data-testid="cred-setup-gh-docs"
                  onClick={() => open("https://cli.github.com/")}
                >
                  Install docs →
                </button>
              </section>
            </div>
          </Dialog>
        );
      }}
    </Show>
  );
}
