// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, createEffect, createSignal, type JSX } from "solid-js";

import type { GpgPreferences } from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";

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
    </div>
  );
}
