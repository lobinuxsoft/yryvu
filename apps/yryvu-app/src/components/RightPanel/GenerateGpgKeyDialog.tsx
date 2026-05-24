// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show, type JSX } from "solid-js";

import {
  generateGpgKey,
  setSigningKey,
  type GeneratedKey,
} from "../../ipc";
import { Dialog } from "../Dialog";
import { notify } from "../Notifications";

export interface GenerateGpgKeyDialogProps {
  open: boolean;
  /// Pre-filled values from the repo's `user.name` / `user.email`. The
  /// user can override before generating.
  defaultName: string;
  defaultEmail: string;
  /// Repo path the new key should be wired into via `user.signingkey`.
  /// `null` (no repo loaded) skips the wire — the user can still copy
  /// the public key for manual setup.
  repoPath: string | null;
  onClose: () => void;
  /// Called once the new key has been written to git config so the
  /// caller can refresh its `SignConfig` resource.
  onGenerated: () => void;
}

type Phase =
  | { kind: "form" }
  | { kind: "generating" }
  | { kind: "success"; key: GeneratedKey }
  | { kind: "error"; message: string };

export function GenerateGpgKeyDialog(
  props: GenerateGpgKeyDialogProps,
): JSX.Element {
  const [name, setName] = createSignal(props.defaultName);
  const [email, setEmail] = createSignal(props.defaultEmail);
  const [passphrase, setPassphrase] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>({ kind: "form" });

  function reset() {
    setName(props.defaultName);
    setEmail(props.defaultEmail);
    setPassphrase("");
    setPhase({ kind: "form" });
  }

  async function handleGenerate() {
    if (!name().trim() || !email().trim()) {
      setPhase({
        kind: "error",
        message: "Name and email are required.",
      });
      return;
    }
    setPhase({ kind: "generating" });
    try {
      const key = await generateGpgKey({
        name: name(),
        email: email(),
        passphrase: passphrase(),
      });
      // Auto-wire into git config so the next commit picks it up.
      if (props.repoPath) {
        try {
          await setSigningKey(props.repoPath, key.fingerprint, "open-pgp");
        } catch (e) {
          // Generation succeeded; just the wiring failed. Surface but
          // don't hide the new public key — the user can still paste it.
          notify.error("Could not set user.signingkey", {
            message: String(e),
            category: "commit",
          });
        }
      }
      setPhase({ kind: "success", key });
      props.onGenerated();
    } catch (e) {
      setPhase({ kind: "error", message: String(e) });
    }
  }

  async function copyPublicKey() {
    const p = phase();
    if (p.kind !== "success") return;
    try {
      await navigator.clipboard.writeText(p.key.publicKeyArmored);
      notify.success("Public key copied to clipboard", {
        message: "Paste into GitHub → Settings → SSH and GPG keys",
        category: "commit",
      });
    } catch (e) {
      notify.error("Clipboard write failed", {
        message: String(e),
        category: "commit",
      });
    }
  }

  function close() {
    reset();
    props.onClose();
  }

  return (
    <Dialog
      open={props.open}
      title="Generate new GPG Key"
      size={phase().kind === "success" ? "wide" : "default"}
      onClose={() => close()}
      footer={
        <Show
          when={phase().kind === "success"}
          fallback={
            <>
              <button class="dialog__btn" type="button" onClick={() => close()}>
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
          <button class="dialog__btn" type="button" onClick={() => close()}>
            Done
          </button>
        </Show>
      }
    >
      <Show when={phase().kind === "form" || phase().kind === "generating"}>
        <p class="dialog__hint">
          This will create a 4096 bit key with the name and email below
          that expires in 2 years. The new key is also set as your active
          signing key for this repo.
        </p>
        <label class="dialog__field">
          <span>Name</span>
          <input
            type="text"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            disabled={phase().kind === "generating"}
          />
        </label>
        <label class="dialog__field">
          <span>Email</span>
          <input
            type="email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            disabled={phase().kind === "generating"}
          />
        </label>
        <label class="dialog__field">
          <span>Passphrase (optional)</span>
          <input
            type="password"
            value={passphrase()}
            onInput={(e) => setPassphrase(e.currentTarget.value)}
            disabled={phase().kind === "generating"}
            placeholder="Leave empty for no passphrase"
          />
        </label>
      </Show>
      <Show when={phase().kind === "success"}>
        {(() => {
          const p = phase() as Extract<Phase, { kind: "success" }>;
          return (
            <>
              <p>
                <strong>GPG Key Created Successfully</strong>
              </p>
              <p class="dialog__hint">
                Fingerprint <code>{p.key.fingerprint}</code> — already
                wired as <code>user.signingkey</code>. Paste the
                armored public key below into GitHub →{" "}
                <em>Settings → SSH and GPG keys → New GPG key</em>.
              </p>
              <textarea
                class="dialog__armored"
                readonly
                rows="14"
                value={p.key.publicKeyArmored}
              />
            </>
          );
        })()}
      </Show>
      <Show when={phase().kind === "error"}>
        {(() => {
          const p = phase() as Extract<Phase, { kind: "error" }>;
          return <p class="dialog__warning">{p.message}</p>;
        })()}
      </Show>
    </Dialog>
  );
}
