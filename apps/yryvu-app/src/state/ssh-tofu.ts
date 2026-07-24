// SPDX-License-Identifier: AGPL-3.0-or-later

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createSignal } from "solid-js";

import { sshTofuResolve } from "../ipc/ssh";

/// Payload of the `ssh-tofu-prompt` event. Must match `TofuPrompt` in
/// `crates/yryvu-bridge/src/repo/remote/tofu.rs`.
export interface SshTofuPrompt {
  sessionId: string;
  host: string;
  /** `SHA256:…` — the same fingerprint OpenSSH prints. */
  fingerprint: string;
}

/// Must match `SSH_TOFU_PROMPT_EVENT` in the backend.
const SSH_TOFU_PROMPT_EVENT = "ssh-tofu-prompt";

/// A first-contact SSH host blocks its fetch/push in the backend until
/// the user answers. Concurrent operations (e.g. fetch-all across
/// several SSH remotes) can each raise a prompt, so they queue and are
/// shown one at a time rather than stacking modals.
const [queue, setQueue] = createSignal<SshTofuPrompt[]>([]);

/// The prompt currently awaiting an answer, or `null`.
export const currentTofuPrompt = () => queue()[0] ?? null;

let unlisten: UnlistenFn | null = null;

/// Subscribe to backend TOFU prompts. Idempotent — a second call is a
/// no-op until [`unmountSshTofuListener`] runs.
export async function mountSshTofuListener(): Promise<void> {
  if (unlisten) return;
  unlisten = await listen<SshTofuPrompt>(SSH_TOFU_PROMPT_EVENT, (event) => {
    setQueue((q) => [...q, event.payload]);
  });
}

/// Tear down the listener (tests / teardown).
export function unmountSshTofuListener(): void {
  unlisten?.();
  unlisten = null;
  setQueue([]);
}

/// Answer the current prompt and advance the queue. `accept` trusts the
/// host; anything else aborts its operation. A backend timeout resolves
/// the block on its own, so dropping an unanswered prompt is safe.
export function respondSshTofu(accept: boolean): void {
  const prompt = currentTofuPrompt();
  if (!prompt) return;
  void sshTofuResolve(prompt.sessionId, accept);
  setQueue((q) => q.slice(1));
}
