// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show, type JSX } from "solid-js";
import { Dialog } from "../../../Dialog";
import {
  normalizeHostnameUrl,
  selfHostedHostname,
  setSelfHostedHostname,
} from "./selfHostedHostnames";
import type { ProviderInfo } from "./providerTable";

/**
 * Self-hosted configuration dialog. Mirror of GK's
 * `SelfHostedConfiguration` modal at `bundle:486`–`501`:
 *
 *   - Title: `SelfHostedConfiguration-Title`
 *   - Body label: `SelfHostedConfiguration-EnterHostname`
 *   - Input: autoFocus, placeholder `http://gitkraken.example.com`
 *   - Submit: disabled when input empty or loading
 *
 * **chajá deviations**:
 * - Placeholder uses `https://git.example.com` instead of GK's literal
 *   `http://gitkraken.example.com`. Modern self-hosted setups default
 *   to TLS; nudging http:// in the placeholder is a footgun.
 * - Bare hostnames auto-prepend `https://` on submit (chajá QoL —
 *   `git.example.com` becomes `https://git.example.com`).
 * - Inline error under the input on invalid URL, instead of GK's
 *   submit-then-toast pattern. Catches typos before the dispatch.
 *
 * The submitted URL persists in `selfHostedHostnames.ts` (signal-only
 * this PR; persistence lands with backend cluster).
 */
export function SelfHostedConfigurationDialog(props: {
  open: boolean;
  provider: ProviderInfo;
  onClose: () => void;
  onSubmit: () => void;
}): JSX.Element {
  // Local input state seeded from the persisted hostname so reopening
  // the dialog after a save shows the current value.
  const [input, setInput] = createSignal(selfHostedHostname(props.provider.type)());
  const [error, setError] = createSignal<string | null>(null);

  // Re-seed on each open. createSignal initial value is captured at
  // mount; the dialog unmounts on close (Show), so a fresh open gets
  // a fresh signal — no manual sync needed beyond the `open` toggle.

  const submit = () => {
    const result = normalizeHostnameUrl(input());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelfHostedHostname(props.provider.type, result.url);
    setError(null);
    props.onSubmit();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog
      open={props.open}
      title={`Configure ${props.provider.verboseLabel}`}
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
            disabled={input().trim().length === 0}
            onClick={submit}
          >
            Save
          </button>
        </>
      }
    >
      <div data-testid="self-hosted-configuration-dialog">
        <p class="dialog__hint">
          Enter the URL of your {props.provider.verboseLabel} instance
          (e.g. <code>https://{props.provider.type === "jiraServer" ? "jira" : "git"}.example.com</code>).
        </p>
        <input
          type="text"
          autofocus
          placeholder="https://git.example.com"
          value={input()}
          onInput={(e) => {
            setInput(e.currentTarget.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
        />
        <Show when={error()}>
          <p class="dialog__error">{error()}</p>
        </Show>
      </div>
    </Dialog>
  );
}
