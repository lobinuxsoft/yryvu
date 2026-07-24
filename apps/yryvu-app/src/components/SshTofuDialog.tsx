// SPDX-License-Identifier: AGPL-3.0-or-later

import { Dialog } from "./Dialog";
import { currentTofuPrompt, respondSshTofu } from "../state/ssh-tofu";

/// Trust-On-First-Use prompt for an unknown SSH host (#508).
///
/// Raised when a fetch/push reaches a host not in `known_hosts`. The
/// backend has blocked the operation waiting on the answer. A changed or
/// revoked key never reaches here — it is rejected outright — so the only
/// decision is whether to trust a genuinely new host after checking its
/// fingerprint out of band. Cancel (the default focus, Escape, or the
/// button) aborts; there is deliberately no "always trust" affordance.
export function SshTofuDialog() {
  const prompt = currentTofuPrompt;

  return (
    <Dialog
      open={prompt() !== null}
      title="Unknown SSH host"
      dismissOnBackdrop={false}
      onClose={() => respondSshTofu(false)}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            onClick={() => respondSshTofu(false)}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            onClick={() => respondSshTofu(true)}
          >
            Trust &amp; continue
          </button>
        </>
      }
    >
      <p>
        The authenticity of host <code>{prompt()?.host}</code> can't be
        established — yryvu has never connected to it before.
      </p>
      <p style={{ "margin-top": "8px" }}>Key fingerprint:</p>
      <pre
        style={{
          "user-select": "text",
          background: "var(--bg-1)",
          padding: "8px",
          "border-radius": "var(--radius-sm, 4px)",
          "overflow-x": "auto",
          "font-family": "var(--font-mono)",
        }}
      >
        {prompt()?.fingerprint}
      </pre>
      <p
        style={{
          color: "var(--fg-3)",
          "font-size": "12px",
          "margin-top": "8px",
        }}
      >
        Verify this fingerprint against the one your Git provider publishes
        (or the server administrator) before trusting it. Only continue if it
        matches — a mismatch can mean a man-in-the-middle. On trust, the key
        is added to <code>~/.ssh/known_hosts</code>.
      </p>
    </Dialog>
  );
}
