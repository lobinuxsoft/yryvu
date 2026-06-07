// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";
import {
  detectAuthEnv,
  getHostingService,
  type AuthEnv,
  type HostingService,
} from "../ipc";

/**
 * Credential setup wizard (#44). Push / delete-remote rely on libgit2's
 * credential callback, which fails with a single opaque error when no SSH
 * key, credential helper, or integration token is usable. Rather than
 * dump that text in a toast, we probe the environment and offer the user
 * a concrete next step.
 */
export interface CredentialWizardState {
  /** Repo whose push/delete-remote failed — used to deep-link the PAT. */
  repoPath: string;
  /** Hosting service detected from the repo's remote, for tailored copy. */
  provider: HostingService;
  /** Environment snapshot taken at the moment of failure. */
  env: AuthEnv;
}

const [credentialWizard, setCredentialWizard] =
  createSignal<CredentialWizardState | null>(null);
export { credentialWizard };

/** Cached probe primed at startup; re-run on each auth failure so the
 * wizard reflects keys the user may have loaded since launch. */
const [authEnv, setAuthEnv] = createSignal<AuthEnv | null>(null);
export { authEnv };

/** Run the probe once at app startup (acceptance: "Detection runs at
 * startup"). Best-effort — a failed probe just leaves the cache empty. */
export async function primeAuthEnv(): Promise<void> {
  try {
    setAuthEnv(await detectAuthEnv());
  } catch {
    // Probe is advisory; ignore failures.
  }
}

/** Recognises libgit2's "every credential method failed" error surfaced
 * by `credentials.rs::build_callbacks_inner`. */
function isNoCredentialsError(err: unknown): boolean {
  return String(err).includes("no credentials available");
}

/**
 * If `err` is a missing-credentials failure, open the setup wizard and
 * return `true` so the caller suppresses its generic error toast.
 * Otherwise return `false` and the caller surfaces the error normally.
 */
export async function handleRemoteAuthError(
  err: unknown,
  repoPath: string,
): Promise<boolean> {
  if (!isNoCredentialsError(err)) return false;
  let env = authEnv();
  try {
    env = await detectAuthEnv();
    setAuthEnv(env);
  } catch {
    // Fall back to the primed snapshot (or null) if the re-probe fails.
  }
  const provider = await getHostingService(repoPath).catch(
    () => "unknown" as HostingService,
  );
  setCredentialWizard({
    repoPath,
    provider,
    env: env ?? {
      sshAgentSocket: false,
      sshKeysLoaded: 0,
      credentialHelper: null,
      hostOs: "unknown",
    },
  });
  return true;
}

export function closeCredentialWizard(): void {
  setCredentialWizard(null);
}
