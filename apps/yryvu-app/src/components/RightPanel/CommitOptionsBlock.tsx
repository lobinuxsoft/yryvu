// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";

import type { SignConfig } from "../../ipc";
import {
  pendingCommitOptionsExpanded,
  setPendingCommitOptionsExpanded,
  setSignCommitEnabled,
  setSkipHooksEnabled,
  signCommitEnabled,
  skipHooksEnabled,
} from "../../state";
import { Tooltip } from "../Tooltip";
import { GenerateGpgKeyDialog } from "./GenerateGpgKeyDialog";

export interface CommitOptionsBlockProps {
  /// Repo signing config or `undefined` while loading. `key === null`
  /// disables the Sign toggle with a "configure user.signingkey" hint.
  signConfig: SignConfig | undefined;
  /// Repo path the in-app key generator should wire `user.signingkey`
  /// into. `null` when no repo is loaded (shouldn't happen from the
  /// CommitPanel, but kept for future call sites).
  repoPath: string | null;
  /// Default name/email for the generator dialog, pulled from
  /// `user.name` / `user.email` in the repo config.
  defaultName: string;
  defaultEmail: string;
  /// Called after the generate dialog wired a new key so the parent's
  /// `SignConfig` resource can re-fetch.
  onKeyGenerated: () => void;
}

export function CommitOptionsBlock(props: CommitOptionsBlockProps) {
  const [generateOpen, setGenerateOpen] = createSignal(false);
  const keyConfigured = () => props.signConfig?.key != null;
  const signLabel = () => {
    const cfg = props.signConfig;
    if (!cfg) return "Sign with GPG / SSH";
    return cfg.format === "ssh" ? "Sign with SSH" : "Sign with GPG";
  };
  const signHint = () => {
    const cfg = props.signConfig;
    if (!cfg) return "Loading signing config…";
    if (!cfg.key) return "Set user.signingkey in git config to enable";
    const fmt = cfg.format === "ssh" ? "SSH" : "OpenPGP";
    return `${fmt} via ${cfg.program} · key ${cfg.key}`;
  };

  return (
    <div class="commit-panel__options">
      <button
        class="commit-panel__options-toggle"
        type="button"
        aria-expanded={pendingCommitOptionsExpanded()}
        onClick={() => setPendingCommitOptionsExpanded((v) => !v)}
      >
        <span
          class="commit-panel__options-chevron"
          data-collapsed={pendingCommitOptionsExpanded() ? "false" : "true"}
        >
          ▸
        </span>
        Commit Options
      </button>
      <Show when={pendingCommitOptionsExpanded()}>
        <div class="commit-panel__options-body">
          <label class="commit-panel__option">
            <input
              type="checkbox"
              checked={skipHooksEnabled()}
              onInput={(e) => setSkipHooksEnabled(e.currentTarget.checked)}
            />
            <span>Skip pre-commit hooks</span>
            <Tooltip text="libgit2 never runs hooks; this flag is plumbed for future gix migration">
              <span class="commit-panel__option-hint">
                (no-op on current backend)
              </span>
            </Tooltip>
          </label>
          <label
            class="commit-panel__option"
            data-disabled={keyConfigured() ? "false" : "true"}
          >
            <input
              type="checkbox"
              checked={signCommitEnabled() && keyConfigured()}
              disabled={!keyConfigured()}
              onInput={(e) => setSignCommitEnabled(e.currentTarget.checked)}
            />
            <span>{signLabel()}</span>
            <Tooltip text={signHint()}>
              <span class="commit-panel__option-hint">
                {keyConfigured() ? "(configured)" : "(no key configured)"}
              </span>
            </Tooltip>
          </label>
          <Show when={!keyConfigured()}>
            <button
              class="commit-panel__option-action"
              type="button"
              onClick={() => setGenerateOpen(true)}
            >
              Generate new GPG Key
            </button>
          </Show>
        </div>
      </Show>
      <GenerateGpgKeyDialog
        open={generateOpen()}
        defaultName={props.defaultName}
        defaultEmail={props.defaultEmail}
        repoPath={props.repoPath}
        onClose={() => setGenerateOpen(false)}
        onGenerated={() => {
          setGenerateOpen(false);
          props.onKeyGenerated();
        }}
      />
    </div>
  );
}
