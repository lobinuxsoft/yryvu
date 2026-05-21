// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  type JSX,
} from "solid-js";

import {
  exportGpgPublicKey,
  listGpgKeys,
  type GpgKeyInfo,
  type GpgPreferences,
} from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";
import { notify } from "../../Notifications";
import { GenerateGpgKeyDialog } from "../../RightPanel/GenerateGpgKeyDialog";

/// Empty / whitespace input → `null` (mirrors `Tools.tsx` convention).
function normalize(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

type BoolField = Exclude<keyof GpgPreferences, "signingKeyId">;

const TOGGLES: ReadonlyArray<{
  field: BoolField;
  label: string;
  hint: string;
}> = [
  {
    field: "signCommitsByDefault",
    label: "Sign commits by default",
    hint: "Adds the equivalent of -S / --gpg-sign to every commit.",
  },
  {
    field: "signTagsByDefault",
    label: "Sign tags by default",
    hint: "Adds -s / --sign to every tag creation.",
  },
  {
    field: "sshSigningEnabled",
    label: "Use SSH signing (gpg.format=ssh)",
    hint: "Requires Git 2.34+ and a configured SSH signing key.",
  },
];

/**
 * GPG signing preferences panel (issue #104, subset).
 *
 * Stores the free-form signing key identifier (fingerprint / email /
 * blank for Git default) plus three sign-by-default toggles. Out of
 * scope (locked at issue level): keyring enumeration via `gpg`,
 * passphrase caching, test-sign button, and per-profile bindings —
 * all need either shelling out to the `gpg` binary or the profile
 * system from #22, which has not landed.
 *
 * Toggle rows reuse `.notifications-panel__*` styling, key-id input
 * reuses `.tools-panel__input` — both shapes are identical to the
 * existing Tools / Notifications panels.
 */
export function GpgPanel(): JSX.Element {
  const [keyIdLocal, setKeyIdLocal] = createSignal("");
  const [generateOpen, setGenerateOpen] = createSignal(false);
  const [armored, setArmored] = createSignal<string | null>(null);
  const [keyringNonce, setKeyringNonce] = createSignal(0);

  // Enumerate secret keys from the user's gpg keyring so the panel can
  // show an existing-keys picker instead of forcing manual fingerprint
  // entry. Re-fetched after Generate succeeds via `keyringNonce`.
  const [keyring] = createResource<GpgKeyInfo[], number>(keyringNonce, () =>
    listGpgKeys().catch(() => [] as GpgKeyInfo[]),
  );

  createEffect(() => {
    const prefs = preferences();
    if (!prefs) return;
    setKeyIdLocal(prefs.gpg.signingKeyId ?? "");
  });

  const persist = (patch: Partial<GpgPreferences>) => {
    if (!preferences()) return;
    void updatePreferences({ gpg: patch });
  };

  const ready = () => preferences() !== undefined;
  const hasKey = () => keyIdLocal().trim().length > 0;

  async function copyPublicKey() {
    const selector = keyIdLocal().trim();
    if (!selector) return;
    try {
      const text = await exportGpgPublicKey(selector);
      setArmored(text);
      await navigator.clipboard.writeText(text);
      notify.success("Public key copied to clipboard", {
        message: "Paste into GitHub → Settings → SSH and GPG keys",
        category: "preferences",
      });
    } catch (e) {
      notify.error("Could not export public key", {
        message: String(e),
        category: "preferences",
      });
    }
  }

  const boolValue = (field: BoolField): boolean => {
    const prefs = preferences();
    return prefs ? prefs.gpg[field] : false;
  };

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Signing key</h3>
      <p class="ui-panel__helper">
        Identifier for the key Git should use when signing — a GPG
        fingerprint, a <code>name@example.com</code> address, or an SSH
        public-key path. Leave empty to defer to Git's own{" "}
        <code>user.signingkey</code> resolution.
      </p>

      <div class="tools-panel__field">
        <label class="ui-panel__label" for="gpg-panel-key-id">
          Key identifier
        </label>
        <input
          id="gpg-panel-key-id"
          class="tools-panel__input"
          type="text"
          placeholder="ABCD1234EF567890"
          value={keyIdLocal()}
          disabled={!ready()}
          onInput={(e) => setKeyIdLocal(e.currentTarget.value)}
          onChange={(e) =>
            persist({ signingKeyId: normalize(e.currentTarget.value) })
          }
        />
      </div>

      <Show when={(keyring() ?? []).length > 0}>
        <div class="gpg-panel__keyring">
          <h4 class="ui-panel__label">Keys in your gpg keyring</h4>
          <For each={keyring() ?? []}>
            {(k) => (
              <button
                type="button"
                class="gpg-panel__keyring-row"
                data-selected={
                  keyIdLocal().trim() === k.fingerprint ||
                  keyIdLocal().trim() === k.keyId
                    ? "true"
                    : "false"
                }
                onClick={() => {
                  setKeyIdLocal(k.fingerprint);
                  persist({ signingKeyId: k.fingerprint });
                }}
              >
                <span class="gpg-panel__keyring-uid">{k.uid}</span>
                <code class="gpg-panel__keyring-id">{k.keyId}</code>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="gpg-panel__actions">
        <button
          type="button"
          class="dialog__btn"
          disabled={!ready()}
          onClick={() => setGenerateOpen(true)}
        >
          Generate new GPG Key
        </button>
        <button
          type="button"
          class="dialog__btn"
          disabled={!ready()}
          onClick={() => setKeyringNonce((n) => n + 1)}
        >
          Reload GPG keys
        </button>
        <button
          type="button"
          class="dialog__btn dialog__btn--primary"
          disabled={!ready() || !hasKey()}
          onClick={() => void copyPublicKey()}
        >
          Copy public key
        </button>
      </div>
      <Show when={armored()}>
        <textarea
          class="dialog__armored"
          readonly
          rows="12"
          value={armored() ?? ""}
        />
      </Show>

      <h3 class="preferences__section-title gpg-panel__sub-heading">
        Defaults
      </h3>

      <div class="notifications-panel__rows">
        <For each={TOGGLES}>
          {(row) => (
            <label class="notifications-panel__row">
              <input
                type="checkbox"
                class="notifications-panel__toggle"
                checked={boolValue(row.field)}
                disabled={!ready()}
                onChange={(e) =>
                  persist({ [row.field]: e.currentTarget.checked })
                }
              />
              <span class="notifications-panel__label">
                <span class="notifications-panel__label-text">{row.label}</span>
                <span class="notifications-panel__hint">{row.hint}</span>
              </span>
            </label>
          )}
        </For>
      </div>

      <GenerateGpgKeyDialog
        open={generateOpen()}
        defaultName=""
        defaultEmail=""
        repoPath={null}
        onClose={() => setGenerateOpen(false)}
        onGenerated={() => {
          setGenerateOpen(false);
          // Refresh the keyring listing so the new key shows up
          // immediately as a picker row.
          setKeyringNonce((n) => n + 1);
        }}
      />
    </div>
  );
}
